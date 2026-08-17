/**
 * The divine rate, available to anything that prints a price.
 *
 * Every price on the page follows one rule — chaos below a divine, divine at or above it — and
 * the rule needs the rate. Passing it down by prop would mean threading one number through the
 * charts, three tables, the header and the item drawer, and any component that forgot it would
 * silently print in the wrong unit rather than fail to compile.
 *
 * A context makes the rate ambient and the formatter the only way to print a price, which is
 * what keeps the rule in one place instead of six.
 *
 * ## What is deliberately not denominated
 *
 * The divine rate itself. "205c per divine" is the conversion; quoting it in divine would print
 * "1.00 div" and say nothing. It stays chaos everywhere it appears, and that is not an oversight.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  chartUnit,
  formatPrice,
  formatPriceRate,
  formatSignedPrice,
  type ChartUnit,
} from './format.ts';

const DivineRate = createContext(0);

export function DenominationProvider({
  divineRate,
  children,
}: {
  divineRate: number;
  children: ReactNode;
}) {
  return <DivineRate.Provider value={divineRate}>{children}</DivineRate.Provider>;
}

export interface Prices {
  /** Chaos below a divine, divine at or above it. Always carries its unit. */
  price: (chaos: number) => string;
  /** The same, signed, for a change rather than a holding. */
  signed: (chaos: number) => string;
  /** The same, per hour. */
  rate: (chaosPerHour: number) => string;
  /** One unit for a whole axis, chosen from its peak. */
  axis: (values: number[]) => ChartUnit;
  /** The raw rate, for the few places that must print chaos regardless. */
  divineRate: number;
}

export function usePrices(): Prices {
  const divineRate = useContext(DivineRate);
  return useMemo(
    () => ({
      price: (chaos: number) => formatPrice(chaos, divineRate),
      signed: (chaos: number) => formatSignedPrice(chaos, divineRate),
      rate: (chaosPerHour: number) => formatPriceRate(chaosPerHour, divineRate),
      axis: (values: number[]) => chartUnit(values, divineRate),
      divineRate,
    }),
    [divineRate],
  );
}
