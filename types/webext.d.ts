// The WebExtension surface this extension is allowed to touch.
//
// Hand-written rather than pulled from `@types/*` on purpose: the list is short,
// it is the same list the README justifies to anyone reading the permissions,
// and a new API showing up here is a visible diff instead of an autocomplete.
// Adding an entry means the extension does something new - say so in the README.

interface WebExtEvent<Listener extends (...args: never[]) => unknown> {
  addListener(listener: Listener): void;
  removeListener(listener: Listener): void;
  hasListener(listener: Listener): boolean;
}

interface WebExtMessageSender {
  id?: string;
  url?: string;
  frameId?: number;
  tab?: { id?: number; url?: string };
}

interface WebExtTab {
  id?: number;
  url?: string;
}

interface WebExtBrowser {
  runtime: {
    id: string;
    getURL(path: string): string;
    getManifest(): { name: string; version: string } & Record<string, unknown>;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: WebExtEvent<
      (
        message: unknown,
        sender: WebExtMessageSender,
        sendResponse: (response: unknown) => void,
      ) => boolean | undefined
    >;
    onInstalled: WebExtEvent<(details: { reason: string }) => void>;
    // Opening the settings from the bubble. Needs no permission: it is this
    // extension's own page.
    openOptionsPage(): Promise<void>;
  };
  storage: {
    local: {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
    // How a page finds out that the vocabulary changed in another tab, without
    // anything having to be told which tabs exist.
    onChanged: WebExtEvent<
      (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void
    >;
  };
  tabs: {
    create(properties: { url: string; active?: boolean }): Promise<WebExtTab>;
  };
  action: {
    onClicked: WebExtEvent<(tab: WebExtTab) => void>;
  };
}

declare var browser: WebExtBrowser | undefined;
declare var chrome: WebExtBrowser | undefined;
