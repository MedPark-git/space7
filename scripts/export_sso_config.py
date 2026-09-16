"""Validate/export the inactive preparation bundle without running the portal."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sso_preparation import client_profile, configuration_bundle, load_manifest, overview


def main():
    parser = argparse.ArgumentParser(description="Validate and export MedPark SSO preparation")
    parser.add_argument("--client", help="Registered client ID, e.g. medpark-space-06")
    parser.add_argument("--check", action="store_true", help="Only show inventory validation counts")
    parser.add_argument("--output", type=Path, help="Destination JSON file; defaults to stdout")
    args = parser.parse_args()
    try:
        data = load_manifest()
        result = overview(data)["summary"] if args.check else client_profile(data, args.client) if args.client else configuration_bundle(data)
        output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            args.output.write_text(output, encoding="utf-8")
        else:
            print(output, end="")
    except (ValueError, KeyError, OSError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
