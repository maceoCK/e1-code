const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const {
  initialProviders,
  normalizeProvider,
  resolveKey,
} = require("./providers.cjs");
const { atomicJson, readJson } = require('./library-identity.cjs');
class Store {
  constructor(dir, vault) {
    this.dir = dir;
    this.vault = vault;
    this.memoryKeys = new Map();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, "workspace.json");
    this.historyFile = path.join(dir, 'chat-library.json');
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT")
        throw Error(
          "Cannot read the saved workspace. Preserve workspace.json before restoring a backup.",
        );
      this.data = {
        providers: initialProviders(),
        chats: [],
        selection: {
          provider: "openai",
          model: "",
          profile: "auto",
          maxTokens: 2048,
        },
        theme: "mist",
        routing: { enabled: true, allowApiFallback: false, order: [] },
      };
    }
    const history = readJson(this.historyFile, null);
    if (!history) {
      // Migrate the old prototype history once; native chats already live in
      // the separate, pinned workspace profile.
      if (fs.existsSync(this.file) && !fs.existsSync(this.file + '.before-library-split')) fs.copyFileSync(this.file, this.file + '.before-library-split', fs.constants.COPYFILE_EXCL);
      atomicJson(this.historyFile, { version: 1, chats: this.data.chats || [] });
    }
    this.data.chats = history?.chats || this.data.chats || [];
    this.savedChats = JSON.stringify(this.data.chats);
    this.save();
  }
  save() {
    const serialized = JSON.stringify(this.data.chats);
    if (serialized !== this.savedChats) {
      const disk = readJson(this.historyFile, { chats: [] });
      if (JSON.stringify(disk.chats) !== this.savedChats)
        throw Error('Chat history changed in another window. Reload before saving; both copies have been preserved.');
      atomicJson(this.historyFile, { version: 1, chats: this.data.chats });
      this.savedChats = serialized;
    }
    const { chats, ...settings } = this.data;
    atomicJson(this.file, settings);
  }
  publicProvider(p) {
    const { secret, keyFile, ...safe } = p;
    return {
      ...safe,
      hasKey: !!(
        secret ||
        this.memoryKeys.has(p.id) ||
        p.keyFile ||
        p.credential
      ),
      keySource: secret
        ? "Encrypted on this Mac"
        : this.memoryKeys.has(p.id)
          ? "This session"
          : p.keyFile
            ? "Existing Pi gateway configuration"
            : p.credential?.startsWith("pi:")
              ? "Pi configuration"
              : p.credential
                ? "Environment or Pi"
                : "Not required",
    };
  }
  snapshot() {
    return {
      ...this.data,
      providers: [...this.data.providers.map((p) => this.publicProvider(p)), ...(this.subscriptions?.providers() || []), ...(this.claudeAccounts?.providers() || [])],
      keyStorage: this.vault ? "macOS encrypted storage" : "session only",
    };
  }
  provider(id) {
    const p = this.data.providers.find((p) => p.id === id) || this.subscriptions?.providers().find(p => p.id === id) || this.claudeAccounts?.providers().find(p => p.id === id);
    if (!p) throw Error("Provider not found.");
    return p;
  }
  key(p) {
    if (p.authType === 'chatgpt-subscription') return this.subscriptions.token(p.accountId);
    let stored = this.memoryKeys.get(p.id);
    if (p.keyFile && p.baseUrl === p.keyFile.baseUrl) {
      try {
        stored = JSON.parse(fs.readFileSync(p.keyFile.path, "utf8"))[
          p.keyFile.field
        ];
      } catch {
        throw Error(
          "The imported credential file is unavailable. Update this connection’s API key.",
        );
      }
    }
    if (p.secret) {
      if (!this.vault)
        throw Error("Open the desktop app to use its encrypted API key.");
      stored = this.vault.decryptString(Buffer.from(p.secret, "base64"));
    }
    return resolveKey(p, stored);
  }
  setProvider(input) {
    const claude = this.claudeAccounts?.providers().find(p => p.id === input.id);
    if (claude) {
      if (input.apiKey || input.clearKey || (input.protocol !== undefined && input.protocol !== claude.protocol) || (input.baseUrl !== undefined && input.baseUrl !== claude.baseUrl))
        throw Error('Manage this account through the official Claude Code sign-in.');
      this.claudeAccounts.update(claude.accountId, { label: input.name });
      return this.provider(input.id);
    }
    const subscription = this.subscriptions?.providers().find(p => p.id === input.id);
    if (subscription) {
      if (input.apiKey || input.clearKey || (input.protocol !== undefined && input.protocol !== 'responses') || (input.baseUrl !== undefined && input.baseUrl !== subscription.baseUrl))
        throw Error('Manage this subscription with its sign-in controls; its endpoint and credential type are fixed.');
      this.subscriptions.update(subscription.accountId, { label: input.name });
      return this.provider(input.id);
    }
    const old = this.data.providers.find((p) => p.id === input.id);
    let p = normalizeProvider({
      ...old,
      id: input.id,
      name: input.name,
      baseUrl: input.baseUrl,
      protocol: input.protocol,
    });
    if (old && old.baseUrl !== p.baseUrl) {
      delete p.secret;
      delete p.keyFile;
      delete p.credential;
      delete p.credentialBase;
      this.memoryKeys.delete(p.id);
    }
    if (input.clearKey) {
      delete p.secret;
      delete p.keyFile;
      delete p.credential;
      this.memoryKeys.delete(p.id);
    }
    if (input.apiKey) {
      delete p.keyFile;
      const key = String(input.apiKey).trim();
      if (key.length > 8192) throw Error("API key is too long.");
      delete p.credential;
      if (this.vault)
        p.secret = this.vault.encryptString(key).toString("base64");
      else this.memoryKeys.set(p.id, key);
    }
    if (old) this.data.providers[this.data.providers.indexOf(old)] = p;
    else this.data.providers.push(p);
    this.save();
    return this.publicProvider(p);
  }
  newChat(selection) {
    const c = {
      id: crypto.randomUUID(),
      title: "New chat",
      createdAt: Date.now(),
      selection,
      messages: [],
    };
    this.data.chats.unshift(c);
    this.save();
    return c;
  }
  chat(id) {
    const c = this.data.chats.find((c) => c.id === id);
    if (!c) throw Error("Chat not found.");
    return c;
  }
}
module.exports = { Store };
