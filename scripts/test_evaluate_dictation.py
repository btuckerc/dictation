import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("evaluate-dictation.py")
SPEC = importlib.util.spec_from_file_location("evaluate_dictation", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class EvaluationMetricsTests(unittest.TestCase):
    def test_tokenization_normalizes_case_and_punctuation_but_keeps_identifiers(self):
        self.assertEqual(MODULE.tokenize("Use AbortController, OAuth's URL."), ["use", "abortcontroller", "oauth's", "url"])

    def test_wer_counts_substitution_and_deletion(self):
        counts = MODULE.normalized_wer("alpha beta gamma", "alpha delta")
        self.assertEqual(counts["substitutions"], 1)
        self.assertEqual(counts["deletions"], 1)
        self.assertEqual(counts["insertions"], 0)
        self.assertAlmostEqual(counts["wer"], 2 / 3)

    def test_wer_pure_initial_insertion(self):
        counts = MODULE.normalized_wer("alpha beta", "noise alpha beta")
        self.assertEqual(counts["substitutions"], 0)
        self.assertEqual(counts["deletions"], 0)
        self.assertEqual(counts["insertions"], 1)

    def test_wer_pure_initial_deletion(self):
        counts = MODULE.normalized_wer("noise alpha beta", "alpha beta")
        self.assertEqual(counts["substitutions"], 0)
        self.assertEqual(counts["deletions"], 1)
        self.assertEqual(counts["insertions"], 0)

    def test_wer_mixed_initial_edits(self):
        counts = MODULE.normalized_wer("alpha bravo charlie delta echo", "alpha x delta echo extra")
        self.assertEqual(counts["substitutions"], 1)
        self.assertEqual(counts["deletions"], 1)
        self.assertEqual(counts["insertions"], 1)

    def test_empty_reference_is_defined(self):
        self.assertEqual(MODULE.normalized_wer("", "noise")["wer"], 1.0)
        self.assertEqual(MODULE.normalized_wer("", "")["wer"], 0.0)

    def test_protected_terms_require_token_boundaries(self):
        result = MODULE.protected_term_recall("The user ID was null; PostgreSQL is ready.", ["user ID", "null", "SQL", "PostgreSQL"])
        self.assertEqual(result["found"], 3)
        self.assertEqual(result["missing_terms"], ["SQL"])

    def test_protected_terms_are_literal_and_case_sensitive(self):
        result = MODULE.protected_term_recall("getUserByID DATABASE_URL getuserbyid", ["getUserByID", "DATABASE_URL", "getuserbyid"])
        self.assertEqual(result["found"], 3)
        self.assertEqual(result["recall"], 1.0)
        self.assertEqual(MODULE.protected_term_recall("getuserbyid DATABASE URL", ["getUserByID", "DATABASE_URL"])["found"], 0)

    def test_protected_term_matching_allows_phrase_spacing_but_not_substrings(self):
        result = MODULE.protected_term_recall("Keep the OAuth callback URL.", ["oauth", "URL", "callback URL"])
        self.assertEqual(result["found"], 2)
        self.assertEqual(result["missing_terms"], ["oauth"])


if __name__ == "__main__":
    unittest.main()
