# Claude Browser

Desktop AI browser powered by Claude and Electron.

## Run

```bash
export ANTHROPIC_API_KEY="your_api_key"
npm install
npm start
```

The default model is `claude-sonnet-5`. Override it with:

```bash
export ANTHROPIC_MODEL="claude-fable-5"
```

## What it does

- Real desktop browser window using Electron `BrowserView`.
- Real web navigation, back, forward, reload, tabs, and pop-up-to-tab handling.
- Claude side panel that can read the active tab through the main process.
- API key stays in the Electron main process, never in renderer UI code.
