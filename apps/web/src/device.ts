// Device id (spec §6.2): a random UUID minted once into localStorage.
// Storage and the UUID source are injected so the helper stays testable.

export const DEVICE_ID_KEY = "tc_device_id";

export function getDeviceId(
  storage: Pick<Storage, "getItem" | "setItem">,
  mint: () => string = () => crypto.randomUUID(),
): string {
  const existing = storage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = mint();
  storage.setItem(DEVICE_ID_KEY, id);
  return id;
}
