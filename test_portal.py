import os
import unittest
from unittest.mock import patch


os.environ.setdefault("INITIAL_ADMIN_PASSWORD", "LocalValidationOnly!234")

from app import core, plaud_device, portal  # noqa: E402


class PortalSmokeTest(unittest.TestCase):
    def setUp(self):
        self.client = portal.test_client()
        plaud_device._memory_meetings.clear()
        core._memory["labels"].clear()
        core._memory["urls"].clear()
        core._memory["icons"].clear()
        core._memory["order"].clear()
        core._memory["custom"].clear()

    def login(self):
        response = self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "LocalValidationOnly!234"},
        )
        self.assertEqual(response.status_code, 200)

    def test_health_reports_flask(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["runtime"], "python-flask")
        self.assertEqual(response.get_json()["database_state"], "ready")
        self.assertTrue(response.get_json()["admin_ready"])

    def test_portal_and_empty_calendar(self):
        self.login()
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        response.close()
        calendar = self.client.get("/api/calendar/events?month=2026-08")
        self.assertEqual(calendar.status_code, 200)
        self.assertFalse(calendar.get_json()["connected"])
        self.assertEqual(calendar.get_json()["events"], [])

    def test_cancelled_migration_routes_are_absent(self):
        self.assertIn(self.client.post("/api/admin/migrations/ar/import").status_code, (404, 405))
        self.assertIn(self.client.post("/api/admin/migrations/portal/import").status_code, (404, 405))
        response = self.client.get("/tf/ar/health")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"MedPark One", response.get_data())
        response.close()

    def test_plaud_device_webhook_masking_and_excel(self):
        self.login()
        secret = "LocalZapierWebhookSecret!234"
        with patch.dict(os.environ, {"PLAUD_DEVICE_WEBHOOK_SECRET": secret}):
            response = self.client.post(
                "/api/integrations/plaud-device/webhook",
                headers={"X-MedPark-Webhook-Secret": secret},
                json={
                    "external_id": "note-pro-test-1",
                    "title": "신제품 전략 회의",
                    "meeting_date": "2026-09-01T10:00:00+09:00",
                    "duration_seconds": 3600,
                    "participants": ["관리자", "담당자"],
                    "summary": "신제품 출시 일정을 점검했습니다.",
                    "decisions": ["10월 출시"],
                    "action_items": ["자료 보완"],
                    "transcript": "테스트 전사 내용",
                },
            )
            self.assertEqual(response.status_code, 201)
            meeting_id = response.get_json()["meeting_id"]

            masked = self.client.get("/api/meetings/plaud-device")
            self.assertEqual(masked.status_code, 200)
            self.assertIsNone(masked.get_json()["items"][0]["title"])
            self.assertIn("•", masked.get_json()["items"][0]["masked_title"])

            revealed = self.client.get("/api/meetings/plaud-device?reveal_titles=1")
            self.assertEqual(revealed.get_json()["items"][0]["title"], "신제품 전략 회의")

            excel = self.client.get(f"/api/meetings/plaud-device/{meeting_id}/excel")
            self.assertEqual(excel.status_code, 200)
            self.assertIn("spreadsheetml", excel.content_type)

            deleted = self.client.delete(f"/api/meetings/plaud-device/{meeting_id}")
            self.assertEqual(deleted.status_code, 200)
            self.assertTrue(deleted.get_json()["success"])
            self.assertEqual(self.client.get("/api/meetings/plaud-device").get_json()["total"], 0)

    def test_admin_can_update_menu_url_and_delete_custom_menu(self):
        self.login()
        updated = self.client.patch(
            "/api/admin/menu",
            json={
                "labels": {"management_routine": "경영 업무현황"},
                "urls": {"management_routine": "https://example.com/management"},
                "icons": {"management_routine": "M"},
            },
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["urls"]["management_routine"], "https://example.com/management")
        self.assertEqual(updated.get_json()["icons"]["management_routine"], "M")

        admin_calendar = self.client.patch(
            "/api/admin/menu",
            json={
                "labels": {"admin_calendar": "일정(캘린더)_관리자"},
                "urls": {"admin_calendar": ""},
                "icons": {"admin_calendar": "□"},
            },
        )
        self.assertEqual(admin_calendar.status_code, 200)
        self.assertEqual(admin_calendar.get_json()["labels"]["admin_calendar"], "일정(캘린더)_관리자")

        invalid = self.client.patch(
            "/api/admin/menu",
            json={"labels": {"management_routine": "경영 업무현황"}, "urls": {"management_routine": "javascript:alert(1)"}, "icons": {}},
        )
        self.assertEqual(invalid.status_code, 400)

        created = self.client.post(
            "/api/admin/menu",
            json={"group_id": "collaboration", "parent_id": "", "label": "삭제 테스트", "url": "https://example.com/test"},
        )
        self.assertEqual(created.status_code, 201)
        menu_id = created.get_json()["item"]["id"]

        edited = self.client.patch(
            "/api/admin/menu",
            json={"labels": {menu_id: "수정 테스트"}, "urls": {menu_id: "/internal-test"}, "icons": {menu_id: "T"}},
        )
        self.assertEqual(edited.status_code, 200)
        edited_item = next(item for item in edited.get_json()["customItems"] if item["id"] == menu_id)
        self.assertEqual(edited_item["label"], "수정 테스트")
        self.assertEqual(edited_item["url"], "/internal-test")
        self.assertEqual(edited_item["icon"], "T")

        deleted = self.client.delete(f"/api/admin/menu/{menu_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.get_json()["success"])
        self.assertFalse(any(item["id"] == menu_id for item in deleted.get_json()["customItems"]))

    def test_admin_user_department_classification(self):
        self.login()
        base_payload = {
            "username": "department.test",
            "password": "DepartmentTest!234",
            "name": "부서 분류 테스트",
            "role": "basic",
        }
        invalid = self.client.post(
            "/api/admin/users",
            json={**base_payload, "department": "경영지원본부"},
        )
        self.assertEqual(invalid.status_code, 400)

        departments = ("경영사업본부", "마케팅사업본부", "기술사업본부")
        for index, department in enumerate(departments):
            response = self.client.post(
                "/api/admin/users",
                json={**base_payload, "username": f"department.test{index}", "department": department},
            )
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.get_json()["user"]["department"], department)

    def test_audit_logs_are_admin_only_filterable_and_secret_safe(self):
        self.login()
        actor = self.client.get("/api/auth/me").get_json()["user"]
        core.write_audit(
            actor["id"],
            "security.test",
            "test_target",
            "audit-target-1",
            {"password": "must-not-be-returned", "api_key": "must-not-be-returned", "note": "visible"},
            "127.0.0.1",
        )

        response = self.client.get("/api/admin/audits?action=security.test&query=audit-target-1")
        self.assertEqual(response.status_code, 200)
        result = response.get_json()
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["items"][0]["actor"]["username"], "admin")
        self.assertEqual(result["items"][0]["metadata"]["password"], "보호됨")
        self.assertEqual(result["items"][0]["metadata"]["api_key"], "보호됨")
        self.assertEqual(result["items"][0]["metadata"]["note"], "visible")

        created = self.client.post(
            "/api/admin/users",
            json={
                "username": "audit.employee",
                "password": "AuditEmployee!234",
                "name": "감사 로그 일반직원",
                "department": "경영사업본부",
                "role": "basic",
            },
        )
        self.assertEqual(created.status_code, 201)
        employee_client = portal.test_client()
        logged_in = employee_client.post(
            "/api/auth/login",
            json={"username": "audit.employee", "password": "AuditEmployee!234"},
        )
        self.assertEqual(logged_in.status_code, 200)
        self.assertEqual(employee_client.get("/api/admin/audits").status_code, 403)
        self.assertEqual(employee_client.post("/api/auth/logout").status_code, 200)

        logout_logs = self.client.get("/api/admin/audits?action=auth.logout")
        self.assertEqual(logout_logs.status_code, 200)
        self.assertGreaterEqual(logout_logs.get_json()["total"], 1)
        self.assertEqual(self.client.get("/api/admin/audits?date_from=2026/09/03").status_code, 400)


if __name__ == "__main__":
    unittest.main()
