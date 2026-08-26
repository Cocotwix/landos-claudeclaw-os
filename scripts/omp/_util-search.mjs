// Throwaway research driver for the utility slice. Uses the dedicated LandOS
// automation browser only; opens one tab per query and closes it.
import { withAutomationTab } from '../../dist/landos/automation-browser.js';

const queries = process.argv.slice(2);
for (const q of queries) {
  const url = /^https?:/.test(q) ? q : `https://www.google.com/search?q=${encodeURIComponent(q)}&num=20`;
  try {
    const text = await withAutomationTab(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise((r) => setTimeout(r, 2500));
      return page.evaluate(() => document.body.innerText.slice(0, 9000));
    }, { label: 'utility-research' });
    console.log('\n########## ' + q + ' ##########');
    console.log(text);
  } catch (error) {
    console.log('\n########## ' + q + ' ########## FAILED: ' + (error?.message ?? error));
  }
}
