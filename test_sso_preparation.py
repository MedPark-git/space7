import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("INITIAL_ADMIN_PASSWORD", "LocalValidationOnly!234")

import sso_preparation as sso
from app import core, portal


class SSOManifestTests(unittest.TestCase):
    def setUp(self):
        self.data = sso.load_manifest()

    def test_all_current_spaces_and_no_amaranth(self):
        summary = sso.overview(self.data)["summary"]
        self.assertEqual(summary, {"total_spaces": 20, "occupied_spaces": 11, "reserved_spaces": 9, "active_sso_sites": 0})
        self.assertEqual({s["space_label"] for s in self.data["spaces"]}, {f"space_{i:02}" for i in range(1, 21)})
        self.assertEqual(self.data["excluded_integrations"], ["amaranth"])

    def test_each_site_profile_has_exact_individual_redirects(self):
        bundle = sso.configuration_bundle(self.data)
        self.assertEqual(len(bundle["clients"]), 11)
        self.assertEqual(len(bundle["reserved_spaces"]), 9)
        for profile in bundle["clients"]:
            self.assertFalse(profile["enabled"])
            self.assertEqual(profile["oidc_client"]["redirect_uris"], [f'https://{profile["project_id"]}.mycafe24.ai/auth/sso/callback'])
            self.assertNotIn("client_secret", profile["oidc_client"])
            self.assertEqual(profile["client_requirements"]["identity_key"], ["iss", "sub"])

    def test_reserved_and_unknown_clients_cannot_export_live_configuration(self):
        with self.assertRaises(ValueError):
            sso.client_profile(self.data, "medpark-space-02")
        with self.assertRaises(KeyError):
            sso.client_profile(self.data, "unregistered-client")

    def test_foreign_wildcard_insecure_and_redirect_injection_are_rejected(self):
        for uri in ["http://medprk-medpark-allo.mycafe24.ai/auth/sso/callback", "https://evil.example/callback", "https://*.mycafe24.ai/auth/sso/callback", "https://medprk-medpark-allo.mycafe24.ai/auth/sso/callback?next=https://evil.example", "https://medprk-medpark-allo.mycafe24.ai/auth/sso/callback#fragment"]:
            with self.subTest(uri=uri):
                data = copy.deepcopy(self.data)
                data["spaces"][0]["callback_uri"] = uri
                with self.assertRaises(ValueError):
                    sso.validate_manifest(data)

    def test_duplicate_client_space_or_origin_are_rejected(self):
        for key in ["client_id", "space_id", "space_label", "project_id", "public_url"]:
            with self.subTest(key=key):
                data = copy.deepcopy(self.data)
                data["spaces"][2][key] = data["spaces"][0][key]
                with self.assertRaises(ValueError):
                    sso.validate_manifest(data)

    def test_preparation_cannot_enable_auth_or_weaken_policy(self):
        mutations = [lambda d: d.update(authentication_enabled=True), lambda d: d["spaces"][0].update(enabled=True), lambda d: d["policy"].update(pkce_method="plain"), lambda d: d["policy"].update(automatic_account_creation=True), lambda d: d["policy"].update(role_source="portal_admin"), lambda d: d.update(excluded_integrations=[])]
        for change in mutations:
            data = copy.deepcopy(self.data)
            change(data)
            with self.assertRaises(ValueError):
                sso.validate_manifest(data)

    def test_reserved_space_requires_verified_project_address(self):
        data = copy.deepcopy(self.data)
        data["spaces"][1]["callback_uri"] = "https://example.com/callback"
        with self.assertRaises(ValueError):
            sso.validate_manifest(data)

    def test_future_space_can_be_reserved_without_auto_enabling(self):
        data = copy.deepcopy(self.data)
        extra = copy.deepcopy(data["spaces"][-1])
        extra.update(space_id=99999, space_label="space_21", client_id="medpark-space-21")
        data["spaces"].append(extra)
        self.assertEqual(sso.overview(data)["summary"]["total_spaces"], 21)
        self.assertFalse(extra["enabled"])

    def test_meeting_shared_password_and_unverified_sites_are_explicit(self):
        meeting = next(s for s in sso.overview(self.data)["spaces"] if s["space_label"] == "space_06")
        self.assertEqual(meeting["auth_model"], "shared_password")
        self.assertTrue(any("공용 비밀번호" in task for task in meeting["remaining_tasks"]))
        unknown = [s for s in self.data["spaces"] if s["auth_model"] == "unverified"]
        self.assertEqual(len(unknown), 4)

    def test_exports_do_not_modify_inventory(self):
        before = copy.deepcopy(self.data)
        sso.overview(self.data)
        sso.configuration_bundle(self.data)
        self.assertEqual(before, self.data)


class SSOEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = portal.test_client()
        self.admin = core.find_user_by_username("admin")
        self.endpoints = ["/api/admin/sso/preparation", "/api/admin/sso/preparation/export", "/api/admin/sso/preparation/clients/medpark-space-06/config"]

    def login(self):
        response = self.client.post("/api/auth/login", json={"username": "admin", "password": "LocalValidationOnly!234"})
        self.assertEqual(response.status_code, 200)

    def test_anonymous_cannot_read_any_configuration(self):
        for url in self.endpoints:
            self.assertEqual(self.client.get(url).status_code, 401)

    def test_basic_user_cannot_read_any_configuration(self):
        self.login()
        with patch.dict(self.admin, {"role": "basic"}):
            for url in self.endpoints:
                self.assertEqual(self.client.get(url).status_code, 403)

    def test_admin_reads_and_exports_with_no_cache_or_credentials(self):
        self.login()
        for url in self.endpoints:
            result = self.client.get(url)
            self.assertEqual(result.status_code, 200)
            self.assertTrue(result.is_json)
            self.assertIn("no-store", result.headers["Cache-Control"])
            self.assertNotIn("password_hash", result.get_data(as_text=True))
            self.assertNotIn("access_token", result.get_data(as_text=True))
        self.assertIn("attachment", self.client.get(self.endpoints[1]).headers["Content-Disposition"])

    def test_api_has_no_enable_or_write_operation(self):
        self.login()
        for method in (self.client.post, self.client.put, self.client.patch, self.client.delete):
            self.assertEqual(method(self.endpoints[0], json={"authentication_enabled": True}).status_code, 405)

    def test_reserved_client_returns_conflict_unknown_returns_not_found(self):
        self.login()
        self.assertEqual(self.client.get("/api/admin/sso/preparation/clients/medpark-space-02/config").status_code, 409)
        self.assertEqual(self.client.get("/api/admin/sso/preparation/clients/other/config").status_code, 404)

    def test_existing_login_session_and_logout_still_work(self):
        self.login()
        before = self.client.get("/api/auth/me").get_json()
        self.client.get(self.endpoints[0])
        self.client.get(self.endpoints[1])
        self.assertEqual(before, self.client.get("/api/auth/me").get_json())
        self.assertEqual(self.client.post("/api/auth/logout").status_code, 200)
        self.assertEqual(self.client.get(self.endpoints[0]).status_code, 401)

    def test_no_live_oidc_endpoints_are_registered(self):
        self.assertFalse(any(rule.rule.startswith(("/sso/", "/.well-known/")) for rule in portal.url_map.iter_rules()))

    def test_corrupt_config_fails_closed(self):
        self.login()
        with patch.object(sso, "load_manifest", side_effect=ValueError("corrupt")):
            self.assertEqual(self.client.get(self.endpoints[0]).status_code, 503)

    def test_settings_assets_and_index_cache_version(self):
        response = self.client.get("/")
        self.assertIn("sso-settings.css?v=20260916-sso-preparation1", response.get_data(as_text=True))
        self.assertIn("app.js?v=20260916-sso-preparation1", response.get_data(as_text=True))
        response.close()
        for path in ("/sso-settings.js", "/sso-settings.css"):
            result = self.client.get(path)
            self.assertEqual(result.status_code, 200)
            result.close()


if __name__ == "__main__":
    unittest.main()
