import base64
import copy
import hashlib
import json
import os
import unittest
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa


os.environ.setdefault("INITIAL_ADMIN_PASSWORD", "LocalValidationOnly!234")
_test_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_test_pem = _test_key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)
os.environ["SSO_SIGNING_PRIVATE_KEY_B64"] = base64.b64encode(_test_pem).decode()
os.environ["SSO_STATE_SECRET"] = "local-test-state-secret-that-is-long-enough"
for _space in (1, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 16, 18):
    os.environ[f"SSO_CLIENT_SECRET_SPACE_{_space:02}"] = f"client-secret-space-{_space:02}-local"

import sso_master as sso  # noqa: E402
from app import core, portal  # noqa: E402


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


class SSOManifestTests(unittest.TestCase):
    def setUp(self):
        self.data = sso.load_manifest()

    def test_master_inventory_includes_current_spaces_and_excludes_amaranth(self):
        summary = sso.overview(self.data)["summary"]
        self.assertEqual(summary["total_spaces"], 20)
        self.assertEqual(summary["occupied_spaces"], 15)
        self.assertEqual(summary["reserved_spaces"], 5)
        self.assertEqual(summary["registered_clients"], 14)
        self.assertEqual(summary["configured_clients"], 14)
        self.assertTrue(summary["master_ready"])
        self.assertEqual({item["space_label"] for item in self.data["spaces"]}, {f"space_{index:02}" for index in range(1, 21)})
        self.assertEqual(self.data["excluded_integrations"], ["amaranth"])

    def test_medpark_one_is_the_only_master(self):
        masters = [item for item in self.data["spaces"] if item["kind"] == "portal"]
        self.assertEqual(len(masters), 1)
        self.assertEqual(masters[0]["project_id"], "medprk-medpark-one")
        self.assertEqual(self.data["issuer"], "https://medprk-medpark-one.mycafe24.ai/sso")

    def test_client_profiles_use_exact_individual_redirects_and_no_secret_values(self):
        bundle = sso.configuration_bundle(self.data)
        self.assertEqual(len(bundle["clients"]), 14)
        self.assertEqual(len(bundle["reserved_spaces"]), 5)
        serialized = json.dumps(bundle)
        for secret in (value for key, value in os.environ.items() if key.startswith("SSO_CLIENT_SECRET_")):
            self.assertNotIn(secret, serialized)
        for profile in bundle["clients"]:
            expected = f'https://{profile["project_id"]}.mycafe24.ai/auth/sso/callback'
            self.assertEqual(profile["oidc_client"]["redirect_uris"], [expected])
            self.assertEqual(profile["oidc_client"]["pkce_method"], "S256")
            self.assertEqual(profile["account_linking"]["identity_key"], ["iss", "sub"])
            self.assertFalse(profile["account_linking"]["automatic_account_creation"])

    def test_reserved_master_and_unknown_client_profiles_are_rejected(self):
        for client_id in ("medpark-space-02", "medpark-space-07"):
            with self.assertRaises(sso.OAuthError):
                sso.client_profile(self.data, client_id)
        with self.assertRaises(sso.OAuthError):
            sso.client_profile(self.data, "unregistered-client")

    def test_redirect_injection_and_security_policy_weakening_are_rejected(self):
        mutations = [
            lambda data: data.update(authentication_enabled=False),
            lambda data: data.update(excluded_integrations=[]),
            lambda data: data["policy"].update(pkce_method="plain"),
            lambda data: data["policy"].update(automatic_account_creation=True),
            lambda data: data["policy"].update(role_source="portal"),
            lambda data: data["spaces"][0].update(application_type="browser", token_endpoint_auth_method="client_secret_basic"),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                data = copy.deepcopy(self.data)
                mutation(data)
                with self.assertRaises(ValueError):
                    sso.validate_manifest(data)


class SSOEndpointTests(unittest.TestCase):
    client_id = "medpark-space-05"
    redirect_uri = "https://medprk-ar-dashboard.mycafe24.ai/auth/sso/callback"
    verifier = "A" * 43
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())

    def setUp(self):
        self.client = portal.test_client()
        sso._memory_codes.clear()
        sso._memory_tokens.clear()

    def login(self):
        response = self.client.post("/api/auth/login", json={"username": "admin", "password": "LocalValidationOnly!234"})
        self.assertEqual(response.status_code, 200)
        return response

    def authorize(self, client_id=None, redirect_uri=None, **overrides):
        params = {
            "client_id": client_id or self.client_id,
            "redirect_uri": redirect_uri or self.redirect_uri,
            "response_type": "code",
            "scope": "openid profile email",
            "state": "state-123",
            "nonce": "nonce-123",
            "code_challenge": self.challenge,
            "code_challenge_method": "S256",
        }
        params.update(overrides)
        return self.client.get("/sso/authorize", query_string=params)

    def exchange(self, code, **overrides):
        encoded = base64.b64encode(f"{self.client_id}:{os.environ['SSO_CLIENT_SECRET_SPACE_05']}".encode()).decode()
        form = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self.redirect_uri,
            "code_verifier": self.verifier,
        }
        form.update(overrides)
        return self.client.post("/sso/token", data=form, headers={"Authorization": f"Basic {encoded}"})

    def test_discovery_jwks_and_health_are_public_and_ready(self):
        discovery = self.client.get("/sso/.well-known/openid-configuration")
        self.assertEqual(discovery.status_code, 200)
        self.assertEqual(discovery.get_json()["issuer"], sso.ISSUER)
        self.assertEqual(discovery.get_json()["code_challenge_methods_supported"], ["S256"])
        jwks = self.client.get("/sso/jwks.json")
        self.assertEqual(jwks.status_code, 200)
        self.assertEqual(jwks.get_json()["keys"][0]["alg"], "RS256")
        health = self.client.get("/sso/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.get_json()["registered_clients"], 14)

    def test_authorization_code_pkce_id_token_userinfo_replay_and_logout(self):
        self.login()
        authorized = self.authorize()
        self.assertEqual(authorized.status_code, 302)
        query = parse_qs(urlsplit(authorized.location).query)
        self.assertEqual(query["state"], ["state-123"])
        code = query["code"][0]

        token_response = self.exchange(code)
        self.assertEqual(token_response.status_code, 200)
        tokens = token_response.get_json()
        self.assertEqual(tokens["token_type"], "Bearer")
        header_part, payload_part, signature_part = tokens["id_token"].split(".")
        payload = json.loads(base64.urlsafe_b64decode(payload_part + "=" * (-len(payload_part) % 4)))
        self.assertEqual(payload["iss"], sso.ISSUER)
        self.assertEqual(payload["aud"], self.client_id)
        self.assertEqual(payload["nonce"], "nonce-123")
        _test_key.public_key().verify(
            base64.urlsafe_b64decode(signature_part + "=" * (-len(signature_part) % 4)),
            f"{header_part}.{payload_part}".encode(),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )

        userinfo = self.client.get("/sso/userinfo", headers={"Authorization": f"Bearer {tokens['access_token']}"})
        self.assertEqual(userinfo.status_code, 200)
        self.assertEqual(userinfo.get_json()["preferred_username"], "admin")
        self.assertEqual(self.exchange(code).status_code, 400)

        with patch.object(sso, "_dispatch_backchannel"):
            logout = self.client.post("/api/auth/logout")
        self.assertEqual(logout.status_code, 200)
        self.assertEqual(self.client.get("/sso/userinfo", headers={"Authorization": f"Bearer {tokens['access_token']}"}).status_code, 401)

    def test_user_wide_revocation_invalidates_tokens_and_pending_codes(self):
        self.login()
        user_id = self.client.get("/api/auth/me").get_json()["user"]["id"]
        exchanged_code = parse_qs(urlsplit(self.authorize().location).query)["code"][0]
        tokens = self.exchange(exchanged_code).get_json()
        pending_code = parse_qs(urlsplit(self.authorize(state="pending-state").location).query)["code"][0]

        with patch.object(sso, "_dispatch_backchannel"):
            revoked = sso.revoke_user_sessions(user_id)

        self.assertEqual(revoked, 1)
        self.assertEqual(self.client.get("/sso/userinfo", headers={"Authorization": f"Bearer {tokens['access_token']}"}).status_code, 401)
        self.assertEqual(self.exchange(pending_code).get_json()["error"], "invalid_grant")

    def test_anonymous_authorization_resumes_after_medpark_one_login(self):
        first = self.authorize()
        self.assertEqual(first.status_code, 302)
        self.assertEqual(first.location, "/?sso=login")
        self.login()
        resumed = self.client.get("/sso/resume")
        self.assertEqual(resumed.status_code, 302)
        self.assertTrue(resumed.location.startswith(self.redirect_uri + "?code="))
        self.assertIn("state=state-123", resumed.location)

    def test_prompt_none_returns_login_required_to_registered_callback(self):
        result = self.authorize(prompt="none")
        self.assertEqual(result.status_code, 302)
        query = parse_qs(urlsplit(result.location).query)
        self.assertEqual(query["error"], ["login_required"])
        self.assertEqual(query["state"], ["state-123"])

    def test_unregistered_redirect_is_rejected_without_redirecting(self):
        self.login()
        result = self.authorize(redirect_uri="https://evil.example/callback")
        self.assertEqual(result.status_code, 400)
        self.assertIsNone(result.location)
        self.assertEqual(result.get_json()["error"], "invalid_request")

    def test_wrong_pkce_and_client_secret_fail(self):
        self.login()
        code = parse_qs(urlsplit(self.authorize().location).query)["code"][0]
        self.assertEqual(self.exchange(code, code_verifier="B" * 43).get_json()["error"], "invalid_grant")
        wrong = base64.b64encode(f"{self.client_id}:wrong-secret".encode()).decode()
        response = self.client.post("/sso/token", data={"grant_type": "authorization_code", "code": code, "redirect_uri": self.redirect_uri, "code_verifier": self.verifier}, headers={"Authorization": f"Basic {wrong}"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "invalid_client")

    def test_browser_client_uses_pkce_without_secret_and_restricted_cors(self):
        self.login()
        redirect_uri = "https://medprk-yield-management.mycafe24.ai/auth/sso/callback"
        response = self.authorize(client_id="medpark-space-14", redirect_uri=redirect_uri)
        code = parse_qs(urlsplit(response.location).query)["code"][0]
        token = self.client.post(
            "/sso/token",
            data={"grant_type": "authorization_code", "client_id": "medpark-space-14", "code": code, "redirect_uri": redirect_uri, "code_verifier": self.verifier},
            headers={"Origin": "https://medprk-yield-management.mycafe24.ai"},
        )
        self.assertEqual(token.status_code, 200)
        self.assertEqual(token.headers["Access-Control-Allow-Origin"], "https://medprk-yield-management.mycafe24.ai")

    def test_admin_configuration_is_protected_and_contains_no_credentials(self):
        urls = [
            "/api/admin/sso/master",
            "/api/admin/sso/master/export",
            "/api/admin/sso/master/clients/medpark-space-05/config",
        ]
        for url in urls:
            self.assertEqual(self.client.get(url).status_code, 401)
        self.login()
        for url in urls:
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            content = response.get_data(as_text=True)
            self.assertNotIn(os.environ["SSO_CLIENT_SECRET_SPACE_05"], content)
            self.assertNotIn("PRIVATE KEY", content)
            self.assertIn("no-store", response.headers["Cache-Control"])

    def test_logout_redirect_is_exactly_registered(self):
        self.login()
        invalid = self.client.get("/sso/logout", query_string={"client_id": self.client_id, "post_logout_redirect_uri": "https://evil.example/"})
        self.assertEqual(invalid.status_code, 400)
        valid = self.client.get("/sso/logout", query_string={"client_id": self.client_id, "post_logout_redirect_uri": "https://medprk-ar-dashboard.mycafe24.ai/"})
        self.assertEqual(valid.status_code, 302)
        self.assertEqual(valid.location, "https://medprk-ar-dashboard.mycafe24.ai/")


if __name__ == "__main__":
    unittest.main()
