import { test, expect, type Page, type Locator } from '@playwright/test';

const editor = (page: Page, name = 'Editor one') =>
  page.getByRole('region', { name, exact: true });
const draft = (region: Locator) => region.getByLabel('Draft account ID');
const save = (region: Locator) =>
  region.getByRole('button', { name: 'Save draft', exact: true });
const workspace = (page: Page) =>
  page.getByRole('region', { name: 'Billing workspace', exact: true });
const account = (page: Page) =>
  workspace(page).getByTestId('invoice-INV-1').getByTestId('account-id');

for (const mode of ['apollo', 'stateql']) {
  test.describe(`${mode} form policy`, () => {
    test.beforeEach(async ({ page, request }) => {
      await request.post('http://127.0.0.1:4100/__fixture/control', {
        data: { action: 'reset' },
      });
      await page.goto(mode === 'apollo' ? '/' : '/?client=stateql');
      await expect(draft(editor(page))).toHaveValue('A-ledger-1-v1');
      await expect(draft(editor(page, 'Editor two'))).toHaveValue(
        'A-ledger-1-v1',
      );
      await expect(page.getByTestId('request-count')).toHaveText('1 requests');
    });

    test('drafts stay local, pristine fields follow refresh, and dirty conflicts require a choice', async ({
      page,
    }) => {
      const first = editor(page),
        second = editor(page, 'Editor two');
      await draft(first).fill('local-only');
      await expect(draft(second)).toHaveValue('A-ledger-1-v1');
      await expect(account(page)).toHaveText('A-ledger-1-v1');
      await expect(page.getByTestId('request-count')).toHaveText('1 requests');
      await page.getByRole('button', { name: '1. Change server data' }).click();
      await page
        .getByRole('button', { name: '2. Refresh account IDs' })
        .click();
      await expect(draft(first)).toHaveValue('local-only');
      await expect(first.getByTestId('draft-conflict')).toBeVisible();
      await expect(save(first)).toBeDisabled();
      await expect(draft(second)).toHaveValue('A-ledger-1-v2');
      await first
        .getByRole('button', { name: 'Use server value', exact: true })
        .click();
      await expect(draft(first)).toHaveValue('A-ledger-1-v2');
      await draft(first).fill('chosen-edit');
      await page.getByRole('button', { name: '1. Change server data' }).click();
      await page
        .getByRole('button', { name: '2. Refresh account IDs' })
        .click();
      await first.getByRole('button', { name: 'Keep my draft' }).click();
      await save(first).click();
      await expect(first.getByTestId('save-status')).toHaveText(
        'Saved and refreshed.',
      );
      await expect(draft(second)).toHaveValue('chosen-edit');
      await expect(account(page)).toHaveText('chosen-edit');
      await expect(
        workspace(page).getByTestId('invoice-INV-1').getByTestId('amount'),
      ).toHaveText('$125.00');
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `output/playwright/forms-${mode}-mobile.png`,
        fullPage: true,
      });
    });

    test('typing during a save stays unsaved while the submitted value reaches shared state', async ({
      page,
    }) => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let writes = 0;
      await page.route('**/graphql', async (route) => {
        if (route.request().postDataJSON().operationName === 'SaveInvoice') {
          writes++;
          const response = await route.fetch();
          await gate;
          await route.fulfill({ response });
        } else await route.continue();
      });
      const first = editor(page);
      try {
        await draft(first).fill('submitted');
        await save(first).click();
        await expect(first.getByTestId('save-status')).toHaveText('Saving…');
        await draft(first).fill('typed-after-save');
        await expect(save(first)).toBeDisabled();
        await expect(draft(editor(page, 'Editor two'))).toHaveValue(
          'A-ledger-1-v1',
        );
      } finally {
        release();
      }
      await expect(first.getByTestId('save-status')).toHaveText(
        'Saved and refreshed.',
      );
      await expect(draft(first)).toHaveValue('typed-after-save');
      await expect(save(first)).toBeEnabled();
      await expect(draft(editor(page, 'Editor two'))).toHaveValue('submitted');
      await expect(account(page)).toHaveText('submitted');
      expect(writes).toBe(1);
    });

    test('a confirmed save with failed refresh retries only reads', async ({
      page,
    }) => {
      let writes = 0,
        failRead = false;
      await page.route('**/graphql', async (route) => {
        if (route.request().postDataJSON().operationName === 'SaveInvoice') {
          writes++;
          const response = await route.fetch();
          failRead = true;
          await route.fulfill({ response });
        } else if (failRead) {
          failRead = false;
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              errors: [{ message: 'Refresh unavailable' }],
            }),
          });
        } else await route.continue();
      });
      const first = editor(page);
      await draft(first).fill('saved-on-server');
      await save(first).click();
      await expect(first.getByTestId('save-status')).toHaveText(
        'Saved; refresh failed. Retry refresh only.',
      );
      await expect(save(first)).toBeDisabled();
      await draft(first).fill('newer-draft');
      await first
        .getByRole('button', { name: 'Retry refresh', exact: true })
        .click();
      await expect(first.getByTestId('save-status')).toHaveText(
        'Saved and refreshed.',
      );
      await expect(draft(first)).toHaveValue('newer-draft');
      await expect(account(page)).toHaveText('saved-on-server');
      expect(writes).toBe(1);
    });

    test('old save refreshes its own scope after tenant replacement without overwriting the new draft', async ({
      page,
    }) => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/graphql', async (route) => {
        if (route.request().postDataJSON().operationName === 'SaveInvoice') {
          const response = await route.fetch();
          await gate;
          await route.fulfill({ response });
        } else await route.continue();
      });
      try {
        await draft(editor(page)).fill('saved-A');
        await save(editor(page)).click();
        await expect(editor(page).getByTestId('save-status')).toHaveText(
          'Saving…',
        );
        await page.getByLabel('Tenant', { exact: true }).selectOption('B');
        await expect(draft(editor(page))).toHaveValue('B-ledger-1-v1');
        await draft(editor(page)).fill('B-local-draft');
      } finally {
        release();
      }
      await expect(page.getByTestId('request-count')).toHaveText('4 requests');
      await expect(draft(editor(page))).toHaveValue('B-local-draft');
      await expect(editor(page).getByTestId('save-status')).toBeEmpty();
      await page.getByLabel('Tenant', { exact: true }).selectOption('A');
      await expect(draft(editor(page))).toHaveValue('saved-A');
      await editor(page)
        .getByLabel('Invoice', { exact: true })
        .selectOption('INV-2');
      await expect(draft(editor(page))).toHaveValue('A-ledger-2-v1');
    });

    test('unknown acknowledgement blocks resubmission until explicit reconciliation; null is a real value', async ({
      page,
    }) => {
      let writes = 0;
      await page.route('**/graphql', async (route) => {
        if (route.request().postDataJSON().operationName === 'SaveInvoice') {
          writes++;
          await route.fetch();
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{broken',
          });
        } else await route.continue();
      });
      const first = editor(page);
      await draft(first).fill('');
      await expect(save(first)).toBeDisabled();
      await expect(first.getByTestId('draft-validation')).toBeVisible();
      await draft(first).fill('ack-lost');
      await save(first).click();
      await expect(first.getByTestId('save-status')).toContainText(
        'acknowledgement unknown',
      );
      await expect(save(first)).toBeDisabled();
      await first
        .getByRole('button', { name: 'Refresh server value', exact: true })
        .click();
      await expect(first.getByTestId('latest-server')).toContainText(
        'ack-lost',
      );
      await expect(first.getByTestId('save-status')).toContainText(
        'acknowledgement unknown',
      );
      await first
        .getByRole('button', { name: 'Use server value', exact: true })
        .click();
      await expect(first.getByTestId('save-status')).toContainText(
        'acknowledgement remains unknown',
      );
      expect(writes).toBe(1);
      await page.unroute('**/graphql');
      await first
        .getByRole('button', { name: 'Set null', exact: true })
        .click();
      await save(first).click();
      await expect(first.getByTestId('save-status')).toHaveText(
        'Saved and refreshed.',
      );
      await expect(account(page)).toHaveText('(null)');
      await expect(draft(editor(page, 'Editor two'))).toHaveValue('');
    });

    test('known rejection keeps the draft, and removing its record blocks further saves', async ({
      page,
    }) => {
      const first = editor(page);
      await draft(first).fill('retry-me');
      await page.getByText('More scenarios', { exact: true }).click();
      await page.getByRole('button', { name: 'Fail next request' }).click();
      await save(first).click();
      await expect(first.getByTestId('save-status')).toContainText(
        'Save rejected',
      );
      await expect(draft(first)).toHaveValue('retry-me');
      await expect(page.getByTestId('request-count')).toHaveText('2 requests');
      await save(first).click();
      await expect(first.getByTestId('save-status')).toHaveText(
        'Saved and refreshed.',
      );
      await draft(first).fill('preserve-after-delete');
      await page
        .getByRole('button', { name: 'Remove INV-1 on server', exact: true })
        .click();
      await first
        .getByRole('button', { name: 'Refresh server value', exact: true })
        .click();
      await expect(first.getByTestId('unavailable')).toBeVisible();
      await expect(draft(first)).toHaveValue('preserve-after-delete');
      await expect(save(first)).toBeDisabled();
      await expect(
        first.getByRole('button', { name: 'Use server value', exact: true }),
      ).toBeDisabled();
    });

    test('changing invoice during a pending save isolates the replacement editor', async ({
      page,
    }) => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/graphql', async (route) => {
        if (route.request().postDataJSON().operationName === 'SaveInvoice') {
          const response = await route.fetch();
          await gate;
          await route.fulfill({ response });
        } else await route.continue();
      });
      const first = editor(page);
      try {
        await draft(first).fill('saved-first-invoice');
        await save(first).click();
        await expect(first.getByTestId('save-status')).toHaveText('Saving…');
        await first
          .getByLabel('Invoice', { exact: true })
          .selectOption('INV-2');
        await expect(draft(first)).toHaveValue('A-ledger-2-v1');
        await draft(first).fill('second-invoice-local');
      } finally {
        release();
      }
      await expect(account(page)).toHaveText('saved-first-invoice');
      await expect(draft(first)).toHaveValue('second-invoice-local');
      await expect(first.getByTestId('save-status')).toBeEmpty();
      await first.getByLabel('Invoice', { exact: true }).selectOption('INV-1');
      await expect(draft(first)).toHaveValue('saved-first-invoice');
    });

    test('post-save read survives editor disposal after the read has started', async ({
      page,
    }) => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let signalStarted = () => {};
      const started = new Promise<void>((resolve) => {
        signalStarted = resolve;
      });
      let saved = false,
        held = false;
      await page.route('**/graphql', async (route) => {
        const request = route.request().postDataJSON();
        if (request.operationName === 'SaveInvoice') {
          const response = await route.fetch();
          saved = true;
          await route.fulfill({ response });
        } else if (saved && !held) {
          held = true;
          const response = await route.fetch();
          signalStarted();
          await gate;
          await route.fulfill({ response });
        } else await route.continue();
      });
      const completed = page.waitForResponse(
        (response) =>
          response.url().endsWith('/graphql') &&
          !response.request().postDataJSON().query.includes('mutation') &&
          !response.request().postDataJSON().query.includes('amountCents') &&
          JSON.stringify(response.request().postDataJSON().variables).includes(
            '"A"',
          ),
      );
      try {
        await draft(editor(page)).fill('survives-disposal');
        await save(editor(page)).click();
        await started;
        await expect(editor(page).getByTestId('save-status')).toContainText(
          'Saved; refreshing',
        );
        await page.getByLabel('Tenant', { exact: true }).selectOption('B');
        await expect(draft(editor(page))).toHaveValue('B-ledger-1-v1');
      } finally {
        release();
      }
      await completed;
      await page.getByLabel('Tenant', { exact: true }).selectOption('A');
      await expect(draft(editor(page))).toHaveValue('survives-disposal');
      await expect(page.getByTestId('request-count')).toHaveText('4 requests');
    });
  });
}
