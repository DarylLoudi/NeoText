# Manual QA checklist

A pass to run by hand on a clean machine before a release. Automated tests cover a lot of this (the browser tests and the live tests), but they use mock providers or a single known path. This list is for the things only a person, a real provider and a real browser can check.

Run it on a machine that has never run NeoText: a fresh clone, no `data/` folder, no `.env`. Use a real OpenRouter key with a small credit (a dollar is plenty), and the model `deepseek/deepseek-v4.1-flash`. Revoke the key afterwards.

Mark each line pass or fail. For a fail, write what you did, what happened, and the version (`/api/health`). Do not paste keys or chat text into a report.

Record: date, operating system, browser and version, Node version, commit.

## 1. Install and first run

- [ ] `git clone`, `npm ci --ignore-scripts`, `npm run build`, `npm start` all finish without errors.
- [ ] `http://localhost:3420/api/health` answers `{"ok":true,...,"db":"ok"}`.
- [ ] `http://localhost:3420` opens the setup page, in the browser's language (try English and Indonesian).
- [ ] Setup: choose "Just me", create a username and a passphrase. A weak or mismatched password is refused with a message that says what to fix.
- [ ] The recovery key is shown once. "Continue" stays disabled until the box is ticked. Download works.
- [ ] The provider step takes an OpenRouter key and connects. "Skip for now" also works.
- [ ] Ctrl+C stops the server cleanly (no crash message). Starting it again shows the sign-in page, and the passphrase works.

## 2. A real chat

- [ ] Open a new chat. The model sheet shows context size and price per million tokens before you send.
- [ ] Pick `deepseek/deepseek-v4.1-flash`, send "Say hello in one sentence."
- [ ] The answer streams in, with the marker caret, and ends cleanly.
- [ ] The message shows time taken and a cost. The chat and the usage page show a cost that matches.
- [ ] The chat gets a title on its own within a few seconds.
- [ ] Ask for a code sample. The code block is highlighted and Copy works.
- [ ] Regenerate. A switcher shows 2 / 2 and moves between the versions.
- [ ] Edit your first message and send. A new branch appears and the old one is still there.

## 3. Web search with citations

- [ ] Turn on Web and ask something current ("What is today's date and one headline from the news?").
- [ ] "Searching the web" shows while it runs.
- [ ] The answer has numbered citation chips. Hovering one shows the source.
- [ ] The Sources strip shows cards with pages. "All sources" opens a drawer you can filter.
- [ ] Clicking a source opens it in a new tab. No request goes to a site you did not click (check the browser's network panel: icons come from NeoText itself).

## 4. Stop, reload, kill

- [ ] Ask for a long answer ("Write 500 words about tea"). Press Stop. The partial text stays, "Stopped." shows, and Send comes back.
- [ ] Reload the page. The stopped answer is still there.
- [ ] Ask for another long answer. While it streams, reload the tab. The answer keeps going and finishes. The question was sent only once.
- [ ] Ask for a long answer. While it streams, close the tab, wait ten seconds, open NeoText again. The full answer is there.
- [ ] Ask for a long answer. While it streams, kill the server (close the terminal or end the process). Start it again with `npm start`. Open the chat. The text written so far is kept, nothing is duplicated, and the chat is usable.

## 5. Settings and their history

- [ ] Change the theme, the accent and the sidebar side. Each applies at once.
- [ ] Reload and restart the server. All three are still set.
- [ ] Open Settings, Data. Several versions are listed. Restore an older one. The old look comes back and the list keeps the settings you had before, so the restore can be undone.
- [ ] Open the same account in a second browser tab, change a setting in one, and check the other follows after a reload, with no lost setting.

## 6. Export and import

- [ ] Settings, Data, Export, "NeoText file (encrypted)", with a passphrase. A file downloads.
- [ ] Export as Markdown and as JSON. The plain formats ask you to confirm they are not encrypted.
- [ ] Attach a small file to a chat, export again, and check the dialog says the file was left out.
- [ ] Import the NeoText file into a second, empty NeoText (new data folder). Chats, folders and presets arrive. Choose a model for the imported chats.
- [ ] Import a real ChatGPT export and a real Claude export if you have them. The chats appear in a sensible order with readable text.
- [ ] Import a file that is not an export (rename a text file to .zip). The app says what is wrong and nothing breaks.

## 7. Other features, quickly

- [ ] Compare: add a second model, send one prompt, read both answers, "Continue with this answer".
- [ ] Search (Ctrl+Shift+F) finds text inside an older chat.
- [ ] Create a folder, move a chat into it, pin a chat, delete a chat and undo, empty the trash view.
- [ ] Attach an image or a text file to a message and ask about it.
- [ ] Forgot password: sign out, use "Forgot your password?" with the recovery key, set a new password, save the new recovery key, sign in.
- [ ] Settings, Security: the sessions list shows this device. "Sign out everywhere else" works with a second browser signed in.

## 8. Community mode (second person, second browser)

- [ ] On a fresh data folder, set up with "For a group". Admin appears in the sidebar footer menu.
- [ ] Add a provider and switch on "Share with everyone on this NeoText".
- [ ] Set Sign-ups to "Invite only", create an invite, copy the code. It is shown only once.
- [ ] In a private window, create an account with the code. A second try with the same code is refused.
- [ ] The new member can chat with the shared provider and never sees the key (the provider row says "Shared by your admin", with no edit controls).
- [ ] Set a tiny daily budget for the member in Admin, Users. After it is spent, the next message to the shared model is refused with a clear message. A model on the member's own key still works.
- [ ] A member who opens `/admin` is refused.
- [ ] The only admin cannot demote or disable themselves.

## 9. Phone width

Use the browser's device mode at 375 by 812 (and a real phone if you can reach the server on your network).

- [ ] No sideways scrolling anywhere.
- [ ] The sidebar is a drawer, opened from the top bar, and closes after choosing a chat.
- [ ] The message box stays visible above the keyboard and is easy to tap. Send works.
- [ ] Speaker names sit above the text. Code blocks scroll inside themselves.
- [ ] Settings and the model picker are usable with one thumb. Tap targets are at least 40 pixels.

## 10. Screen reader smoke test

Use NVDA on Windows, VoiceOver on macOS or iOS, or Orca on Linux.

- [ ] The setup and sign-in forms announce labels and errors.
- [ ] The sidebar is announced as a sidebar, and chats read as links with their titles.
- [ ] While an answer streams, you hear that it is generating, not every word. When it finishes, you can read it with the arrow keys.
- [ ] Buttons have names (Send message, Stop generating, Regenerate, Copy, Next sources).
- [ ] Dialogs take focus when they open, trap it, and return it to the button that opened them.
- [ ] Everything above works with the keyboard alone, and the focus ring is always visible.

## 11. Dark mode and motion

- [ ] Choose Dark. Walk through chat, sources, compare, settings, the admin pages and dialogs. Text is easy to read everywhere and nothing is white on white or dark on dark.
- [ ] "System" follows the operating system when you change it.
- [ ] With reduced motion on (the operating system or the NeoText setting), the caret does not breathe and nothing slides.

## 12. Finish

- [ ] Delete the test OpenRouter key from the provider settings, and revoke it on openrouter.ai.
- [ ] Note every failure above with steps, and file it as an issue (not security problems; see SECURITY.md).
