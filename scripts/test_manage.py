import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import manage


class WorkflowInstallationTests(unittest.TestCase):
    def setUp(self):
        self.config = {
            "projectDir": "/project", "stateDir": "/state", "codexHome": "/bot-home",
            "channelId": "123456789012345678", "allowedUsers": "all", "timeoutMs": 60000,
        }

    def test_all_plugins_are_added_including_existing_installations(self):
        catalog = {
            "installed": [{"name": "namuk-process"}],
            "available": [{"name": "namuk-process"}, {"name": "discord-feedback"}, {"name": "my-pstack"}],
        }
        with patch.object(manage, "run", return_value=SimpleNamespace(stdout=json.dumps(catalog))) as run:
            self.assertEqual(manage.install_workflow(self.config), "namuk-process@namuk-marketplace")
            self.assertEqual([call.args[0] for call in run.call_args_list], [
                ["codex", "plugin", "list", "-m", "namuk-marketplace", "--available", "--json"],
                ["codex", "plugin", "add", "namuk-process", "-m", "namuk-marketplace", "--json"],
                ["codex", "plugin", "add", "discord-feedback", "-m", "namuk-marketplace", "--json"],
                ["codex", "plugin", "add", "my-pstack", "-m", "namuk-marketplace", "--json"],
            ])
            for call in run.call_args_list:
                self.assertEqual(call.kwargs["env"]["CODEX_HOME"], "/bot-home")

    def test_empty_catalog_stops_before_installation(self):
        with patch.object(manage, "run", return_value=SimpleNamespace(stdout='{"installed":[],"available":[]}')) as run:
            with self.assertRaisesRegex(manage.SetupError, "찾을 수 없습니다"):
                manage.install_workflow(self.config)
            self.assertEqual(run.call_count, 1)

    def test_invalid_catalog_stops_before_installation(self):
        with patch.object(manage, "run", return_value=SimpleNamespace(stdout='invalid')) as run:
            with self.assertRaisesRegex(manage.SetupError, "해석할 수 없습니다"):
                manage.install_workflow(self.config)
            self.assertEqual(run.call_count, 1)


if __name__ == "__main__":
    unittest.main()
