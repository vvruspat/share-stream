const nameKey = "sharestream:display-name";

export function loadDisplayName(): string {
  try {
    return (localStorage.getItem(nameKey) || "").slice(0, 60);
  } catch {
    return "";
  }
}

export function saveDisplayName(name: string): void {
  try {
    if (name.trim()) localStorage.setItem(nameKey, name.trim());
    else localStorage.removeItem(nameKey);
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
    // The current session still uses the entered name.
  }
}
