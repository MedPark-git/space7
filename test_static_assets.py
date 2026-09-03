from html.parser import HTMLParser
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"


class MarkupAuditParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.open_options = 0
        self.option_errors = []

    def handle_starttag(self, tag, attrs):
        if tag == "option":
            if self.open_options:
                self.option_errors.append("option element opened before the previous option closed")
            self.open_options += 1

    def handle_endtag(self, tag):
        if tag == "option":
            if not self.open_options:
                self.option_errors.append("option closing tag without an opening tag")
                return
            self.open_options -= 1


class StaticAssetIntegrityTest(unittest.TestCase):
    def test_public_assets_do_not_expose_redaction_markers(self):
        offenders = []
        for path in PUBLIC_DIR.rglob("*"):
            if not path.is_file():
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            if "REDACTED" in content.upper():
                offenders.append(str(path.relative_to(ROOT)))
        self.assertEqual(offenders, [], f"redaction markers found in public assets: {offenders}")

    def test_employee_role_options_have_valid_closing_tags(self):
        html = (PUBLIC_DIR / "index.html").read_text(encoding="utf-8")
        parser = MarkupAuditParser()
        parser.feed(html)
        parser.close()
        self.assertEqual(parser.option_errors, [])
        self.assertEqual(parser.open_options, 0)
        self.assertIn('<option value="basic">기본(임직원)</option>', html)
        self.assertIn('<option value="admin">관리자</option>', html)


if __name__ == "__main__":
    unittest.main()
