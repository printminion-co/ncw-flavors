import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, resolveReport } from './helpers.ts';

// These tests read the real flavors committed on this branch, on purpose: they are the only ones that do.

test('the real flavor1 resolves, extends the upstream base and activates both app folders', () => {
  const report = resolveReport(REPO_ROOT, 'flavor1');
  assert.deepEqual(report.app_folders, ['apps-upstream', 'apps-flavor1']);
  for (const id of ['contacts', 'calendar', 'tasks', 'notes']) {
    assert.equal(report.apps[id], 'default', id);
  }
  // groupfolders cannot be enabled by `occ maintenance:install` (its migration needs the app to be loaded), so the
  // script enables it after the install
  assert.equal(report.apps.groupfolders, 'available');
  assert.deepEqual(report.enable_after_install, ['groupfolders']);
  // common wins over upstream-33
  assert.equal(report.apps.files, 'always');
  assert.equal(report.apps.workflowengine, 'removed');
  assert.equal(report.apps.firstrunwizard, 'removed');
  assert.equal(report.apps.support, 'removed');
  assert.equal(report.apps.demo, undefined);
});

const OFFICIAL_53 = [
  'activity', 'admin_audit', 'app_api', 'bruteforcesettings', 'circles', 'cloud_federation_api', 'comments',
  'contactsinteraction', 'dashboard', 'dav', 'encryption', 'federatedfilesharing', 'federation', 'files',
  'files_downloadlimit', 'files_external', 'files_pdfviewer', 'files_reminders', 'files_sharing', 'files_trashbin',
  'files_versions', 'firstrunwizard', 'logreader', 'lookup_server_connector', 'nextcloud_announcements',
  'notifications', 'oauth2', 'password_policy', 'photos', 'privacy', 'profile', 'provisioning_api',
  'recommendations', 'related_resources', 'serverinfo', 'settings', 'sharebymail', 'support', 'survey_client',
  'suspicious_login', 'systemtags', 'text', 'theming', 'twofactor_backupcodes', 'twofactor_nextcloud_notification',
  'twofactor_totp', 'updatenotification', 'user_ldap', 'user_status', 'viewer', 'weather_status',
  'webhook_listeners', 'workflowengine',
];

test('the real base upstream-33 lists exactly the 53 apps of the official 33.0.9 archive', () => {
  const manifest = parse(readFileSync(join(REPO_ROOT, 'bases/upstream-33/flavor.yaml'), 'utf8')) as {
    app_dirs: string[];
    apps: Record<string, string>;
  };
  assert.equal(OFFICIAL_53.length, 53);
  assert.deepEqual(Object.keys(manifest.apps).sort(), [...OFFICIAL_53].sort());
  assert.deepEqual(manifest.app_dirs, ['apps-upstream']);
  for (const mode of Object.values(manifest.apps)) assert.ok(['always', 'default', 'available', 'removed'].includes(mode));
});
