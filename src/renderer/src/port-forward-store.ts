import { desktop } from './desktop-api';
import { PersistentForwards } from './persistent-forwards';

export const portForwardStore = new PersistentForwards(desktop, () => localStorage);
