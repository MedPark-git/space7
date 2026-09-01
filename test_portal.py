import os
import unittest
from unittest.mock import patch


os.environ.setdefault("INITIAL_ADMIN_PASSWORD", "LocalValidationOnly!234")

from app import plaud_device, portal  # noqa: E402


class PortalSmokeTest(unittest.TestCase):
    def setUp(self):
        self.client = portal.test_client()
        plaud_device._memory_meetings.clear()

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


if __name__ == "__main__":
    unittest.main()
