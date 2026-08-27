import os
import unittest


os.environ.setdefault("INITIAL_ADMIN_PASSWORD", "LocalValidationOnly!234")

from app import portal  # noqa: E402


class PortalSmokeTest(unittest.TestCase):
    def setUp(self):
        self.client = portal.test_client()

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


if __name__ == "__main__":
    unittest.main()
