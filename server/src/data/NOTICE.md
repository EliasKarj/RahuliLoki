# Third-party data in this directory

## `dust.json`

Thaumaturgic Dust values for 1,103 unique items, and the gold cost and inventory footprint of
disenchanting each one.

Taken from **[deronek/poe-disenchant-tool](https://github.com/deronek/poe-disenchant-tool)**
(`data/dust/poe-dust.js`), which publishes it under the MIT licence. It is reformatted — the
same six fields per item, as JSON with shorter keys, so it can be read without evaluating a
JavaScript file from another repository — and otherwise unaltered.

The two dust columns are the value at item level 84 with no quality and with 20% quality. Both
are kept because the pair is what makes the rest derivable: the ratio between them gives the
item's inherent influence and corruption multiplier, and from that the base dust follows. See
`services/dust.ts`, which reproduces both published columns for 1,102 of the 1,103 rows exactly
and the remaining one to within a single dust.

### Licence

```
MIT License

Copyright (c) 2025 Mateusz Dionizy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Keeping it current

It is a snapshot. GGG adds uniques, and a unique this file has never heard of shows no dust
rather than a wrong one — which is the failure worth having, but it is still a failure. Refresh
it by re-reading `data/dust/poe-dust.js` from the repository above.
