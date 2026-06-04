// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseXMLTV } from './xmltv-parser';

// Format a Date as an XMLTV UTC timestamp: YYYYMMDDHHMMSS +0000
function xmltvDate(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())} +0000`
  );
}

describe('parseXMLTV', () => {
  it('parses channels with display names and icons', () => {
    const xml = `<?xml version="1.0"?>
      <tv>
        <channel id="chan1">
          <display-name>Channel One</display-name>
          <icon src="http://logo/chan1.png"/>
        </channel>
      </tv>`;
    const { channels } = parseXMLTV(xml);
    expect(channels['chan1']).toEqual({ name: 'Channel One', icon: 'http://logo/chan1.png' });
  });

  it('parses programmes that fall within the ±7 day window', () => {
    const start = new Date();
    const stop = new Date(start.getTime() + 60 * 60 * 1000);
    const xml = `<?xml version="1.0"?>
      <tv>
        <channel id="c1"><display-name>Chan</display-name></channel>
        <programme channel="c1" start="${xmltvDate(start)}" stop="${xmltvDate(stop)}">
          <title>The Show</title>
          <desc>An episode</desc>
        </programme>
      </tv>`;
    const { programmes } = parseXMLTV(xml);
    expect(programmes['c1']).toHaveLength(1);
    expect(programmes['c1'][0].title).toBe('The Show');
  });

  it('drops programmes far outside the time window', () => {
    const old = new Date('2000-01-01T00:00:00Z');
    const oldStop = new Date('2000-01-01T01:00:00Z');
    const xml = `<?xml version="1.0"?>
      <tv>
        <channel id="c1"><display-name>Chan</display-name></channel>
        <programme channel="c1" start="${xmltvDate(old)}" stop="${xmltvDate(oldStop)}">
          <title>Ancient</title>
        </programme>
      </tv>`;
    const { programmes } = parseXMLTV(xml);
    expect(programmes['c1']).toBeUndefined();
  });
});
