import unittest
from unittest.mock import patch
from subprocess import CompletedProcess
from build_macos import choose_identity, require_app_stopped


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


class InstallationSafetyTests(unittest.TestCase):
    def test_running_app_cannot_be_replaced(self):
        with patch('build_macos.subprocess.run', return_value=CompletedProcess([], 0)):
            with self.assertRaisesRegex(SystemExit, 'Quit Dictation'):
                require_app_stopped()

    def test_process_inspection_failure_does_not_allow_installation(self):
        with patch('build_macos.subprocess.run', return_value=CompletedProcess([], 2)):
            with self.assertRaisesRegex(SystemExit, 'Could not determine'):
                require_app_stopped()


if __name__ == '__main__':
    unittest.main()
