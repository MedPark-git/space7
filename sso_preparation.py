"""Backward-compatible imports for the former SSO preparation module.

New code should import :mod:`sso_master` directly.
"""

from sso_master import (  # noqa: F401
    ISSUER,
    MANIFEST_PATH,
    OAuthError,
    PORTAL_URL,
    client_profile,
    configuration_bundle,
    load_manifest,
    overview,
    validate_manifest,
)
