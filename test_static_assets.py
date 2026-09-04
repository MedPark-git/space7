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
        marker = "RED" + "ACTED"
        for path in PUBLIC_DIR.rglob("*"):
            if not path.is_file():
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            if marker in content.upper():
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

    def test_employee_department_is_a_required_three_choice_select(self):
        html = (PUBLIC_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn('부서(팀)<select name="department" required>', html)
        departments = ("경영사업본부", "마케팅사업본부", "기술사업본부")
        for department in departments:
            self.assertEqual(html.count(f'<option value="{department}">{department}</option>'), 2)

    def test_employee_registration_and_admin_approval_interface_is_connected(self):
        html = (PUBLIC_DIR / "index.html").read_text(encoding="utf-8")
        javascript = (PUBLIC_DIR / "app.js").read_text(encoding="utf-8")
        registration_markup = html.split('<dialog id="registrationDialog"', 1)[1].split("</dialog>", 1)[0]
        self.assertIn("아직 임직원 계정이 없으신가요?", html)
        self.assertIn("임직원 등록 신청", html)
        self.assertGreaterEqual(html.count("아마란스 계정"), 2)
        self.assertEqual(html.count("사번(선택)"), 2)
        self.assertNotIn('name="role"', registration_markup)
        self.assertIn("/api/auth/register", javascript)
        self.assertIn("/approve", javascript)
        self.assertIn('method: "DELETE"', javascript)
        self.assertIn("관리자 직접 등록", javascript)
        self.assertIn("20260904-registration1", html)

    def test_audit_log_admin_interface_is_connected(self):
        javascript = (PUBLIC_DIR / "app.js").read_text(encoding="utf-8")
        self.assertIn("SECURITY ACTIVITY", javascript)
        self.assertIn("/api/admin/audits?", javascript)
        self.assertIn("감사 로그를 불러오는 중입니다.", javascript)
        self.assertNotIn("감사 로그</h2><p>이 기능은 다음 구현 단계", javascript)


if __name__ == "__main__":
    unittest.main()
