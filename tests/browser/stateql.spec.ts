import { test, expect, type Page } from '@playwright/test';

const workspace = (page: Page) =>
  page.getByRole('region', { name: 'Billing workspace', exact: true });
const monitor = (page: Page) =>
  page.getByRole('region', { name: 'Account monitor', exact: true });
const invoice = (page: Page) => workspace(page).getByTestId('invoice-INV-1');

test.beforeEach(async ({ page, request }) => {
  await request.post('http://127.0.0.1:4100/__fixture/control', {
    data: { action: 'reset' },
  });
  await page.goto('/?client=stateql');
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'A-ledger-1-v1',
  );
  await expect(monitor(page).getByTestId('account-id').first()).toHaveText(
    'A-ledger-1-v1',
  );
  await expect(page.getByTestId('request-count')).toHaveText('1 requests');
});

test('StateQL generates narrow refreshes and updates the derived feature without replacing siblings', async ({
  page,
}) => {
  await page.getByRole('button', { name: '1. Change server data' }).click();
  await page.getByRole('button', { name: '2. Refresh account IDs' }).click();
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'A-ledger-1-v2',
  );
  await expect(monitor(page).getByTestId('account-id').first()).toHaveText(
    'A-ledger-1-v2',
  );
  await expect(invoice(page).getByTestId('amount')).toHaveText('$125.00');
  await expect(invoice(page).getByTestId('user-name')).toHaveText('Ada 1');
  await expect(page.getByTestId('request-count')).toHaveText('2 requests');
  const narrow = page.getByTestId('request-StateQLRead').last();
  await narrow.locator('summary').click();
  await expect(narrow).toContainText('accountId');
  await expect(narrow).not.toContainText('amountCents');
  await expect(narrow).not.toContainText('user');
  await page
    .getByRole('button', { name: 'Refresh all fields', exact: true })
    .click();
  await expect(invoice(page).getByTestId('amount')).toHaveText('$135.00');
  await expect(invoice(page).getByTestId('user-name')).toHaveText('Ada 1 v2');
  await page.screenshot({
    path: 'output/playwright/stateql-desktop.png',
    fullPage: true,
  });
});

test('returning to a tenant does not publish an earlier action status', async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/__fixture/control', async (route) => {
    if (route.request().postDataJSON().action === 'advance') {
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  try {
    const started = page.waitForRequest((request) =>
      request.url().endsWith('/__fixture/control'),
    );
    await page.getByRole('button', { name: '1. Change server data' }).click();
    await started;
    await page.getByLabel('Tenant', { exact: true }).selectOption('B');
    await expect(invoice(page).getByTestId('account-id')).toHaveText(
      'B-ledger-1-v1',
    );
    await page.getByLabel('Tenant', { exact: true }).selectOption('A');
    await expect(invoice(page).getByTestId('account-id')).toHaveText(
      'A-ledger-1-v1',
    );
  } finally {
    release();
  }
  await expect(
    page.getByRole('button', { name: '1. Change server data' }),
  ).toBeEnabled();
  await expect(page.getByRole('status')).toHaveText('Viewing tenant A.');
});

test('StateQL field refresh preserves list order; explicit list refresh replaces it', async ({
  page,
}) => {
  await page.getByText('More scenarios', { exact: true }).click();
  await page.getByRole('button', { name: 'Reverse server order' }).click();
  await page.getByRole('button', { name: '2. Refresh account IDs' }).click();
  await expect(page.getByTestId('request-count')).toHaveText('2 requests');
  await expect(workspace(page).locator('article').first()).toHaveAttribute(
    'data-testid',
    'invoice-INV-1',
  );
  await page.getByRole('button', { name: 'Refresh list membership' }).click();
  await expect(workspace(page).locator('article').first()).toHaveAttribute(
    'data-testid',
    'invoice-INV-2',
  );
  await expect(monitor(page).locator('article').first()).toHaveAttribute(
    'data-testid',
    'invoice-INV-2',
  );
  await expect(invoice(page).getByTestId('amount')).toHaveText('$125.00');
});

test('StateQL failure is visible, retry recovers, and remount reuses shared state', async ({
  page,
}) => {
  await page.getByText('More scenarios', { exact: true }).click();
  await page.getByRole('button', { name: '1. Change server data' }).click();
  await page.getByRole('button', { name: 'Fail next request' }).click();
  await page.getByRole('button', { name: '2. Refresh account IDs' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'A-ledger-1-v1',
  );
  await expect(page.getByTestId('request-count')).toHaveText('2 requests');
  await page.getByRole('button', { name: '2. Refresh account IDs' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'A-ledger-1-v2',
  );
  await page.getByRole('button', { name: 'Unmount monitor' }).click();
  await expect(monitor(page)).toHaveCount(0);
  await page.getByRole('button', { name: '1. Change server data' }).click();
  await page.getByRole('button', { name: '2. Refresh account IDs' }).click();
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'A-ledger-1-v3',
  );
  await page
    .getByRole('button', { name: 'Mount monitor', exact: true })
    .click();
  await expect(monitor(page).getByTestId('account-id').first()).toHaveText(
    'A-ledger-1-v3',
  );
  await expect(page.getByTestId('request-count')).toHaveText('4 requests');
});

test('StateQL switches tenant during a request, resets every tenant cache, and fits mobile', async ({
  page,
}) => {
  await page.getByText('More scenarios', { exact: true }).click();
  await page.getByRole('button', { name: 'Delay responses 1s' }).click();
  await page.getByRole('button', { name: '1. Change server data' }).click();
  const started = page.waitForRequest((request) =>
    request.url().endsWith('/graphql'),
  );
  await page.getByRole('button', { name: '2. Refresh account IDs' }).click();
  await started;
  await page.getByLabel('Tenant', { exact: true }).selectOption('B');
  await expect(workspace(page)).not.toContainText('A-ledger');
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'B-ledger-1-v1',
  );
  await expect(invoice(page).getByTestId('amount')).toHaveText('$455.00');
  await expect(monitor(page)).not.toContainText('A-ledger');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove delay' }).click();
  await page.getByRole('button', { name: '1. Change server data' }).click();
  await page.getByRole('button', { name: '2. Refresh account IDs' }).click();
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'B-ledger-1-v2',
  );
  await page.getByRole('button', { name: 'Reset experiment' }).click();
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'A-ledger-1-v1',
  );
  await expect(page.getByTestId('request-count')).toHaveText('1 requests');
  await page.getByLabel('Tenant', { exact: true }).selectOption('B');
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'B-ledger-1-v1',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'output/playwright/stateql-mobile.png',
    fullPage: true,
  });
});
