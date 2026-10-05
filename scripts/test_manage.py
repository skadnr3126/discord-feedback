import unittest
from unittest.mock import patch

import manage


class WorkflowInstallationTests(unittest.TestCase):
    def setUp(self):
        self.config = {
            "projectDir": "/project", "stateDir": "/state", "codexHome": "/bot-home",
            "channelId": "123456789012345678", "allowedUsers": "all", "timeoutMs": 60000,
        }

    def test_existing_installation_is_reused(self):
        with patch.object(manage, "plugin_list", return_value=[{
            "pluginId": "namuk-process@namuk-marketplace", "enabled": True,
        }]), patch.object(manage, "run") as run:
            self.assertEqual(manage.install_workflow(self.config), "namuk-process@namuk-marketplace")
            run.assert_not_called()

    def test_missing_installation_uses_shared_marketplace(self):
        with patch.object(manage, "plugin_list", return_value=[]), patch.object(manage, "run") as run:
            self.assertEqual(manage.install_workflow(self.config), "namuk-process@namuk-marketplace")
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0], [
                "codex", "plugin", "add", "namuk-process@namuk-marketplace", "--json",
            ])
            self.assertEqual(run.call_args.kwargs["env"]["CODEX_HOME"], "/bot-home")

    def test_disabled_installation_is_preserved(self):
        with patch.object(manage, "plugin_list", return_value=[{
            "pluginId": "namuk-process@namuk-marketplace", "enabled": False,
        }]), patch.object(manage, "run") as run:
            with self.assertRaisesRegex(manage.SetupError, "비활성화"):
                manage.install_workflow(self.config)
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
