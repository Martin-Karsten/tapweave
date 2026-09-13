import { chromium } from '@playwright/test';
import { start_dev_server } from './dev_server.mjs';

const probe_seconds = Number(process.env.PROBE_SECONDS || '60');

const dev_server = start_dev_server();

try {
  await dev_server.wait_for_port();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5180/');

  await page.locator('[data-frame-probe="solid"]').waitFor({ timeout: 20_000 });
  const heap_before = await page.evaluate(() => (performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
  const long_tasks = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const observed: number[] = [];
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) observed.push(entry.duration);
        });
        observer.observe({ entryTypes: ['longtask'] });
        (window as { __long_tasks?: number[] }).__long_tasks = observed;
        (window as { __long_task_observer?: PerformanceObserver }).__long_task_observer = observer;
        resolve(true);
      }),
  );

  await page.locator('[data-probe-action="start"]').click();
  await page.waitForTimeout(probe_seconds * 1000);
  await page.locator('[data-probe-action="stop"]').click();
  await page.waitForTimeout(500);

  const summary = await page.evaluate((seconds) => {
    const stats = (window as { __tapweave_frame_probe: { frame_intervals: number[]; last_frame_count: number; reactive_writes: number; baseline_writes: number } }).__tapweave_frame_probe;
    const sorted = [...stats.frame_intervals].sort((left, right) => left - right);
    const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
    const median = percentile_in_page(sorted, 0.5);
    return {
      wall_seconds: seconds,
      frame_count: stats.last_frame_count,
      effective_fps: stats.last_frame_count / seconds,
      interval_mean_ms: mean,
      interval_median_ms: median,
      interval_p95_ms: percentile_in_page(sorted, 0.95),
      interval_max_ms: sorted[sorted.length - 1],
      dropped_frame_count: sorted.filter((interval) => interval > median * 1.5).length,
      reactive_writes: stats.reactive_writes,
      baseline_writes: stats.baseline_writes,
      long_task_durations: (window as { __long_tasks?: number[] }).__long_tasks ?? [],
      heap_used_before: null,
      heap_used_after: (performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
    };
    function percentile_in_page(values: number[], fraction: number) {
      const index = Math.min(values.length - 1, Math.floor(values.length * fraction));
      return values[index];
    }
  }, probe_seconds);

  const heap_after = await page.evaluate(() => (performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);

  console.log(JSON.stringify({
    ...summary,
    heap_used_before: heap_before,
    heap_delta_bytes: heap_before !== null && heap_after !== null ? heap_after - heap_before : null,
    shell_only_no_engine_frame_path: true,
  }, null, 2));

  await browser.close();
} finally {
  dev_server.stop_dev_server();
}
