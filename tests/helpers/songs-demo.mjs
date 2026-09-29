// Learn mode slots an unjudged "Watch and listen" demo step between a
// passage's Listen step and its first guided step (src/core/teaching.js
// interludeAfter). A walk that only wants to reach the judged step clicks
// its Next once to get past it -- a no-op on any other screen.
export async function skipDemo(page) {
  const heading = await page.evaluate("(document.querySelector('.panel-songs-practice h4') || {}).textContent || ''");
  if (heading.startsWith('Watch and listen')) {
    await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()");
  }
}
