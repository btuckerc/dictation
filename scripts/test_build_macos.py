import unittest
from build_macos import choose_identity


class IdentityTests(unittest.TestCase):
    def test_same_signer_is_deterministic(self):
        self.assertEqual(choose_identity([('b', 'Apple Development: Same'), ('a', 'Apple Development: Same')]), 'a')

    def test_missing_pin_does_not_fall_back(self):
        with self.assertRaises(ValueError):
            choose_identity([('new', 'Apple Development: Same')], pinned='old')

    def test_different_signers_require_selection(self):
        with self.assertRaises(ValueError):
            choose_identity([('a', 'First'), ('b', 'Second')])

    def test_pin_wins_over_auto_selection(self):
        self.assertEqual(choose_identity([('a', 'First'), ('b', 'Second')], pinned='b'), 'b')

    def test_no_identity_cannot_build(self):
        with self.assertRaises(ValueError):
            choose_identity([])


if __name__ == '__main__':
    unittest.main()
