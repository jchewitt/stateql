import { test, expect, type Page } from '@playwright/test';

const workspace = (page: Page) =>
  page.getByRole('region', { name: 'Billing workspace', exact: true });
const monitor = (page: Page) =>
  page.getByRole('region', { name: 'Account monitor', exact: true });
const invoice = (page: Page, id = 'INV-1') =>
  workspace(page).getByTestId(`invoice-${id}`);

test.beforeEach(async ({ page, request }) => {
  await request.post('http://127.0.0.1:4100/__fixture/control', {
    data: { action: 'reset' },
  });
  await page.goto('/');
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'A-ledger-1-v1',
  );
  await expect(page.getByTestId('request-count')).toHaveText('1 requests');
});

test('narrow refresh updates both consumers and inspector; full refetch updates siblings', async ({
  page,
}) => {
  await page.getByRole('button', { name: '1. Change server data' }).click();
  await page.getByRole('button', { name: '2. Refresh account IDs' }).click();
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'A-ledger-1-v2',
  );
  await expect(
    monitor(page).getByTestId('invoice-INV-1').getByTestId('account-id'),
  ).toHaveText('A-ledger-1-v2');
  await expect(invoice(page).getByTestId('amount')).toHaveText('$125.00');
  await expect(invoice(page).getByTestId('user-name')).toHaveText('Ada 1');
  await expect(page.getByTestId('request-count')).toHaveText('2 requests');
  const narrow = page.getByTestId('request-InvoiceAccounts');
  await narrow.locator('summary').click();
  await expect(narrow).toContainText('accountId');
  await expect(narrow).not.toContainText('amountCents');
  await page.getByRole('button', { name: 'Refetch full query' }).click();
  await expect(invoice(page).getByTestId('amount')).toHaveText('$135.00');
  await expect(invoice(page).getByTestId('user-name')).toHaveText('Ada 1 v2');
});

test('reordering, failure recovery, save, and consumer teardown work through the UI', async ({
  page,
}) => {
  await page.getByText('More scenarios', { exact: true }).click();
  await page.getByRole('button', { name: 'Reverse server order' }).click();
  await page.getByRole('button', { name: '2. Refresh account IDs' }).click();
  await expect(workspace(page).locator('article').first()).toHaveAttribute(
    'data-testid',
    'invoice-INV-2',
  );
  await expect(invoice(page).getByTestId('amount')).toHaveText('$125.00');
  await page.getByRole('button', { name: 'Fail next request' }).click();
  await page.getByRole('button', { name: '2. Refresh account IDs' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'A-ledger-1-v1',
  );
  await page.getByRole('button', { name: '2. Refresh account IDs' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('INV-1 account ID').fill('custom-saved');
  await page.getByRole('button', { name: 'Save and refresh' }).click();
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'custom-saved',
  );
  await expect(
    monitor(page).getByTestId('invoice-INV-1').getByTestId('account-id'),
  ).toHaveText('custom-saved');
  await page.getByRole('button', { name: 'Unmount monitor' }).click();
  await expect(monitor(page)).toHaveCount(0);
  await page.getByRole('button', { name: '1. Change server data' }).click();
  await page.getByRole('button', { name: '2. Refresh account IDs' }).click();
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'A-ledger-1-v2',
  );
  await page
    .getByRole('button', { name: 'Mount monitor', exact: true })
    .click();
  await expect(
    monitor(page).getByTestId('invoice-INV-1').getByTestId('account-id'),
  ).toHaveText('A-ledger-1-v2');
});

test('switching tenant during a delayed refresh never renders values from the old tenant', async ({
  page,
}) => {
  await page.getByText('More scenarios', { exact: true }).click();
  await page.getByRole('button', { name: 'Delay responses 1s' }).click();
  await page.getByRole('button', { name: '1. Change server data' }).click();
  const requestStarted = page.waitForRequest(
    (request) =>
      request.url().endsWith('/graphql') &&
      request.postDataJSON().operationName === 'InvoiceAccounts',
  );
  await page.getByRole('button', { name: '2. Refresh account IDs' }).click();
  await requestStarted;
  await page.getByLabel('Tenant', { exact: true }).selectOption('B');
  await expect(workspace(page)).not.toContainText('A-ledger');
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'B-ledger-1-v1',
  );
  await expect(invoice(page).getByTestId('amount')).toHaveText('$455.00');
  await expect(monitor(page)).not.toContainText('A-ledger');
  await page.getByLabel('Tenant', { exact: true }).selectOption('A');
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'A-ledger-1-v2',
  );
});

test('mobile layout fits the viewport and reset restores server and cache', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '1. Change server data' }).click();
  await page.getByRole('button', { name: '2. Refresh account IDs' }).click();
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'A-ledger-1-v2',
  );
  await page.getByText('More scenarios', { exact: true }).click();
  await page.getByRole('button', { name: 'Reset experiment' }).click();
  await expect(invoice(page).getByTestId('account-id')).toHaveText(
    'A-ledger-1-v1',
  );
  await expect(page.getByTestId('request-count')).toHaveText('1 requests');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
