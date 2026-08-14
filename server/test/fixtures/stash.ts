/**
 * Recorded GGG stash payloads. The item shapes are the real ones, markup prefixes and all —
 * `<<set:MS>><<set:M>><<set:S>>` really does turn up in front of names in these responses.
 */

export const tabListResponse = {
  numTabs: 3,
  tabs: [
    { n: 'Currency', i: 0, id: 'aaa', type: 'CurrencyStash', selected: true, colour: { r: 1, g: 2, b: 3 } },
    { n: 'Dump', i: 1, id: 'bbb', type: 'QuadStash', selected: false, colour: { r: 4, g: 5, b: 6 } },
    { n: 'Maps', i: 2, id: 'ccc', type: 'MapStash', selected: false, colour: { r: 7, g: 8, b: 9 } },
    // Hidden tabs (folded into a folder) must not be counted as tabs to read.
    { n: 'Old League', i: 3, id: 'ddd', type: 'PremiumStash', hidden: true },
  ],
  items: [
    {
      id: 'i1',
      typeLine: 'Chaos Orb',
      baseType: 'Chaos Orb',
      stackSize: 250,
      maxStackSize: 5000,
      frameType: 5,
      icon: 'https://web.poecdn.com/chaos.png',
      identified: true,
      x: 0,
      y: 0,
    },
    {
      id: 'i2',
      typeLine: '<<set:MS>><<set:M>><<set:S>>Divine Orb',
      baseType: 'Divine Orb',
      stackSize: 12,
      frameType: 5,
      identified: true,
    },
    {
      id: 'i3',
      typeLine: 'Orb of Alteration',
      baseType: 'Orb of Alteration',
      stackSize: 900,
      frameType: 5,
      identified: true,
    },
  ],
};

export const dumpTabResponse = {
  numTabs: 3,
  items: [
    {
      id: 'd1',
      typeLine: 'The Doctor',
      baseType: 'The Doctor',
      stackSize: 2,
      frameType: 6,
      identified: true,
    },
    {
      id: 'd2',
      name: '<<set:MS>><<set:M>><<set:S>>Headhunter',
      typeLine: 'Leather Belt',
      baseType: 'Leather Belt',
      frameType: 3,
      identified: true,
      corrupted: false,
    },
    {
      // A gem: level and quality change the price, so it is skipped rather than mispriced.
      id: 'd3',
      typeLine: 'Awakened Multistrike Support',
      baseType: 'Awakened Multistrike Support',
      frameType: 4,
      identified: true,
    },
    {
      id: 'd4',
      typeLine: 'Gilded Bestiary Scarab',
      baseType: 'Gilded Bestiary Scarab',
      stackSize: 3,
      frameType: 0,
      identified: true,
    },
    {
      // Nothing prices this. It must show up in `unresolved`, not silently as zero.
      id: 'd5',
      typeLine: 'Fractured Fossil Prototype',
      baseType: 'Fractured Fossil Prototype',
      stackSize: 1,
      frameType: 0,
      identified: true,
    },
  ],
};

export const mapTabResponse = {
  numTabs: 3,
  items: [
    {
      id: 'm1',
      typeLine: 'Beach Map',
      baseType: 'Beach Map',
      frameType: 0,
      identified: true,
      properties: [{ name: 'Map Tier', values: [['16', 0]] }],
    },
  ],
};

export interface RateLimitHeaders {
  limit?: string;
  state?: string;
  retryAfter?: string;
}

export function stashResponse(body: unknown, status = 200, headers: RateLimitHeaders = {}): Response {
  const init: Record<string, string> = { 'content-type': 'application/json' };
  if (headers.limit) init['x-rate-limit-account'] = headers.limit;
  if (headers.state) init['x-rate-limit-account-state'] = headers.state;
  if (headers.retryAfter) init['retry-after'] = headers.retryAfter;
  return new Response(JSON.stringify(body), { status, headers: init });
}
