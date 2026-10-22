# Changelog

All notable changes to Hronaut are documented in this file.

## [Unreleased]

### Changed

- Error notices from Hronaut itself now appear in your interface language, starting with those about Hronaut still starting, opening an address, tab actions such as pinning, moving, labeling, zooming, freezing a page or locking its input, bookmarks, new tabs and reopened tabs, a tab that cannot sleep, a workspace still busy with another task, split view and copying, selecting an element, capturing an area, a page snapshot or a PDF, full-page previews in tab search, workspace names, limits and deletion protection, closing, archiving, restoring and Undo, an archived workspace or workspace storage still busy with another task, moving or copying workspace data, Site access rules, workspace templates, launch at sign-in, runtime settings, MCP capability profiles, release history, the license key and the MCP port, filling a saved password, wallets (unlocking the vault and its passphrase, imports and watch-only wallets, automation policies, confirming a new wallet's recovery phrase and the approval prompt), changing or restoring browser emulation, and the notice shown when the window could not finish loading its tabs or settings and could not stop listening for their changes. A saved password that cannot be decrypted, for example while the system's secure storage is locked, now says so instead of showing the secure storage's own error. Filling a password while an agent command runs, and an emulation change Hronaut could not confirm, now say what to do next, such as restoring the retained settings in **Environment**. When a site cannot be reached for a common reason, such as a refused connection, the notice says so and ends with the code, such as ERR_CONNECTION_REFUSED, instead of repeating the whole address. When an export such as a PDF, a video or a network log cannot be saved because the download folder refuses it, the disk is full or the folder is read-only, the notice says so and ends with the code, such as ENOSPC, without the file name. When another app already uses the MCP port, or the system does not allow it, the notice says so instead of repeating the system's error. A notice about a tab, workspace, archived workspace or bookmark that is already gone says so instead of showing its internal ID. The page shown when Hronaut cannot start speaks your system's language when Hronaut has it, and the error title of the workspace library is translated. Home's buttons and workspace list no longer start an error with "Error invoking remote method". An error a website's page could receive stays in English, so it never tells a website your interface language.
- Hronaut now remembers a site permission, such as location or notifications, for the workspace you made it in, so another workspace, such as another client's, asks again. The prompt names that workspace, since the tab that asks may be in one you are not looking at, such as an agent's, and camera, microphone, file and app link prompts name it too. For a website embedded in a page of another website, such as a video-call widget, the decision also belongs to that page: the prompt names it, and another page that embeds the same website asks again. Allowing a widget on one page used to let every other page that embedded it use the permission without asking, and a decision made in one workspace applied in all of them. Decisions you saved before keep working as they did and show as **All workspaces** in **Settings → Site permissions**, which now names each decision's workspace and embedding page and finds them by either. **Site controls** shows only the decisions that apply to the tab's workspace and page, and changing an **All workspaces** decision there changes it for that workspace only, where the website embedded in another page then asks again. Closing or deleting a workspace for good now forgets its decisions, and so does the next start for a workspace that went while Hronaut was closed. An earlier version of Hronaut ignores the saved decisions once they are in the new format and asks again, and its next decision rewrites the file, so going back to it loses the decisions made in this version.
- `browser_storage` can delete one exact cookie, by its domain and path, while Developer Tools is open for the tab. It used to ask you to close Developer Tools first. A selected cookie that exists only in a partition is now attempted, stays, and is reported as still present with an unknown outcome, where it used to be rejected before anything was sent.
- Once your trial or license has ended, Hronaut now asks for a license with a card under the toolbar, at launch or as soon as access ends, instead of a plain grey bar. It says what stays (your workspaces, sign-ins and saved data), what a license gives agents, and the price, with **Buy license**, **Enter license key** and **Not now**. When a paid license has ended, **License settings** comes first, since a license may only need checking again after a week offline. **Not now** closes the card until the next launch, or until access returns and ends again, and leaves a red **License needed** reminder in the top bar, next to the other controls, which opens License settings and takes the focus the card had. Nothing changes during the trial.
- New profiles now start in the **Cyberpunk** theme, the look hronaut.dev shows, and **Reset to default** in **Settings → Appearance** returns to it; existing profiles keep their theme, **System** included. Cyberpunk itself now uses hronaut.dev's colors: a deeper violet-black canvas (`#0a0414`) and panels (`#12081f`), a cyan-washed hover and finer dividers, with the same cyan and magenta accents. Like every dark theme, Cyberpunk asks websites for their dark appearance, and on macOS and Windows 11 it draws no translucent window material, which only Light and Dark use.
- Hronaut's own scrollbars, in the rail, **Settings**, panels, overlays and Home, now take the theme's colors instead of the system's stock ones (in Cyberpunk, hronaut.dev's `#4e1c6f` thumb). Websites keep their own scrollbars.
- **Settings → Site permissions** has a new switch, **Let websites save to files you open or drop**, off by default. When it is on, an online editor can save changes to a file you opened or dropped on it, such as with Ctrl+S, without asking. As the switch warns, a website could then also overwrite other files in the folder of any file it was given, including one an agent drops on a page, because Electron checks that the same way; turn it on only while you use websites you trust.

### Fixed

- A website's own full screen, such as a video player's, now fills the whole window. Once you allowed **Fullscreen** for the site, the window went into full screen, but the page stayed in its card beside the tabs and under the toolbar. Showing another tab, or a browser shortcut such as **Ctrl/Cmd+L** that opens one of Hronaut's controls, now takes the page out of full screen, and closing a page in full screen takes the window out of it; the window used to stay in full screen showing Home or the other tab, and the next start opened it in full screen.
- The wallet approval dialog now shows only an error about the request in front of you. It used to show the last wallet error from anywhere, so a request could open with the error of an earlier failed unlock in **Settings → Wallets**, or with the failure of the request you had just approved once the next request took its place. When a request fails after it has left the queue, such as a send that fails after you approved it, Hronaut now tells you in a notification.
- On macOS and Windows, two downloads that start at the same time with names that differ only in letter case, such as `Report.pdf` and `report.pdf`, now both keep their file: the second is saved as `report (1).pdf`. Those systems treat the two names as one file, so the download that finished last used to replace the other.
- **Settings**, **Commands**, **Search tabs**, Find, the zoom bar, **Downloads**, **History**, **Bookmarks** or another Hronaut dialog that you open right after pressing **Ctrl/Cmd+T**, or right after **Ctrl/Cmd+L** on Home, now stays open with the keyboard focus. Settings, Search tabs, Find and the zoom bar used to close by themselves a moment later, once the new tab or the website was ready, and the address field took the focus from all of them.
- Pressing Escape in the address field or another field while the agent status popover is open no longer moves the keyboard focus to the agent status button: the popover closes and the focus stays in the field. An Escape that ends typing with an input method, or that the field already used, such as to close the address suggestions, now leaves the popover open. Before, every Escape closed it and pulled the focus away.
- When stopping the worker observation on one tab fails, the reason now shows only on that tab's **Stop observing workers** button, in plain words, until a later stop works or the observation ends. It used to show on the button of every tab observing workers, with a technical prefix, and stayed until the next stop on any tab.
- A late **Could not undo** about an earlier Undo no longer replaces a toast on screen that offers **Undo** for something you did since. When no such toast is showing, it still says that the earlier Undo failed.
- Archiving, closing or clearing a workspace now closes every one of its tabs, even when you show another tab while it does. When the tab you were looking at handed over to a sleeping tab and you, or **Follow agents**, showed another tab meanwhile, that tab stayed open without its workspace, its site data could be deleted under it, and the next start showed the recovery notice and quit. The workspace's sleeping tabs no longer load their sites just before they close, and an agent's `browser_close_tab` no longer leaves the tab open when you select another tab at the same time.
- With **Follow agents** on, a tab an agent opens or selects now waits like the rest of following: while a page you watch fills the window in full screen, while the address field has focus or an agent card is open, while **Settings** or another of Hronaut's dialogs covers the pages, for a few seconds after you use a page, or while another agent is being followed, the tab opens or becomes active in the agent's workspace without taking the view. It used to show at once: it replaced the page behind the address field, **Settings** or an agent card, interrupted you right after you had used a page, and took the view from another agent being followed. A tab an agent opens from a bookmark, its history, or a link or page that opens a new tab now shows once the agent works in it.
- When a website asks to open a link in another app, such as a Zoom or VS Code link, Hronaut now asks for every different link, and its prompt names the link's scheme, such as `zoommtg:`, under the name **External apps**. **Allow** opens only the link it asked about. The prompt used to say only "requests “openExternal” permission", and one Allow was saved for the site, so it could later open any other app, such as `ms-msdt:` or `search-ms:` links, without asking. **Settings → Site permissions** no longer lists such a saved decision, which no longer has any effect.
- After you choose **Deny** for a camera or microphone request, the website can no longer ask for it again and again: the same request from that website, in the page or in any of its frames, is refused without asking until the page loads again. Identical requests made at the same time share one prompt. The same holds for file access, and for links to the same app. A page that asked 25 times at once, or asked again after every refusal, from one frame or from many, used to show one window-blocking prompt after another.
- A permission you allowed for a website now also works in its `about:blank`, `about:srcdoc` and `blob:` frames, such as a mail client's message view or an editor's preview. Those frames were told the permission was granted but their requests were refused without a prompt.
- A sandboxed frame on a website, which runs without an origin of its own, is no longer treated as that website: a permission you allowed for the site, such as **Notifications** or **Clipboard read**, no longer passes Hronaut's permission check for the frame. Hronaut went by the frame's address, so such a frame was told the website's permission was granted.
- When something fails in **Settings** or in one of Hronaut's panels, the message now gives only the reason, such as "The tab is no longer available." It used to start with Electron's technical prefix, "Error invoking remote method '…': Error:". This covers **Settings → MCP security**, **Workspaces & data**, **Downloads**, **Site permissions**, **Passwords** and **License**, the **Network**, **Console**, **History**, **Bookmarks** and **Downloads** panels, site data and storage, the environment and responsive preview panels, the page diagnostics, **Service-worker history**, video recording, reviewed incident packages and workspace templates.
- **Copy credential** under **Settings → MCP security → Capability profiles** now changes to **Credential copied** once the new credential is on the clipboard, and a copy that fails shows a **Copy failed** notice with the reason. The button used to give no sign either way, so you could dismiss the credential, which is shown only once, believing it was copied when it was not. A copy that finishes after you dismissed the credential, or after a newer one replaced it, does not read as copied, but a failed one is still reported. Screen readers announce only the new button label, not the credential again.
- In the **Split view** menu, the keyboard focus now comes back to the control you used, such as **Stacked**, **Swap panes** or the **First pane** slider, once Hronaut has applied the change or reported that it failed. The focus used to leave the menu while the change was applied, so the next Tab started at the top of the window, and after one arrow-key step on the slider the next one did nothing.
- In **Bookmarks**, the keyboard focus now comes back to **Add current** or **Remove current** once the bookmark is saved or removed, so pressing Enter again undoes it, and also when the change fails. The shortcut that bookmarks the current page gives the focus back to the panel control you were on in the same way. The focus used to leave the panel while the change was saved, so Enter did nothing and the next Tab started at the top of the window.
- In **Downloads**, the keyboard focus now comes back to **Show in folder** once the folder opens or Hronaut reports that it could not, for example because the file was deleted. The focus used to leave the panel, so the next Tab started at the top of the window.
- In **Downloads**, when a transfer finishes while the keyboard focus is on its **Pause**, **Resume** or **Cancel download** button, the focus now moves to the first button the finished download offers, such as **Show in folder** or the one that removes it from the list. This also holds when the transfer finishes while Hronaut is still answering the button you pressed. The focus used to leave the panel, so the next Tab started at the top of the window.
- In **History**, the keyboard focus now comes back to an entry when opening it fails, for example because the tab limit is reached, and to **Clear all** when clearing fails; once **Clear all** has emptied History, the focus moves to the panel's close button. The focus used to leave the panel, so Enter could not retry and the next Tab started at the top of the window.
- Closing the focused tab with Delete now moves the keyboard focus to the next tab, or the previous one when it was the last, instead of leaving the tab strip, and a tab you move with **Move Tab Left**, **Move Tab Right** or **Pin Tab** from its menu keeps the focus.
- While you drag a tab, the drop marker now leaves when you move over a tab it cannot be dropped beside, such as the tab itself, a pinned tab or a tab in another workspace. It used to stay beside the last tab you passed, as if dropping would move the tab there.
- The keyboard focus no longer falls out of the window after a button or setting that waits for Hronaut: it comes back to that control, or to its panel or the request filter when that control can no longer be used, in tab search (**Close tab**, **Restore workspace** and **Delete archived workspace** after a failure), the workspace editor (saving with Enter, **Copy selected data** or **Move selected data**, **Close workspace**), Settings (**Reset to default**, a site permission's decision, **Ask where to save each file**, **Change…**, **Open folder**, **Automatically sleep inactive tabs**, **Sleep after**, **Sleep eligible tabs now**, **Choose browser CSV…**), Environment (**Apply**, **Apply & reload**, **Reset environment**, **Restore retained settings**) and the **Network** panel's **Clear**. Back from a full-page preview opened with Alt+Enter in tab search now returns to the search field instead of the tab's More actions button.
- The keyboard focus also comes back after **Apply preview** and **Reset viewport** in the responsive preview, **Zoom in**, **Zoom out** and **Reset** in the zoom bar, moving, switching, removing and adding request conditions in the **Network** panel, **Copy page snapshot** in **Page tools**, and the video recorder's buttons, such as **Add annotation**. When the control can no longer be used, such as **Reset** at 100% or a removed condition's button, or would now act on another item, such as a video annotation's **Remove** once the next annotation takes its row, the focus goes to its panel, never to another button that a held Enter would press. The focus used to leave the window, so pressing Enter again on **Zoom in** did nothing and the next Tab started at the top of the window.
- In **Settings → Wallets**, a bounded policy you are writing is no longer cleared when you save the wallet's workspace access, rename it, add or remove another policy, or approve or reject a wallet request, and workspace access choices you have not saved yet are no longer reset by those changes either. Every such change read the wallet list again, and the new copy of the same wallet counted as choosing another wallet. Choosing another wallet still starts its drafts over.
- In the **Console**, a newer message no longer closes an expanded call stack or takes the keyboard focus off a row's Copy button, and a repeated message keeps its row.
- Hronaut keeps saving your tabs and workspaces after it refuses an address whose scheme or host is extremely long, such as one with a 600-letter scheme typed in the address bar or sent by an agent. The workspace's record of refused addresses kept it in full, the saved session refuses an entry that long, and every later save failed silently, so tabs and workspaces changed afterwards were gone at the next start. Such an address is now recorded as an invalid address.
- Agents can keep using the browser after many long reviews. Hronaut kept up to 100 finished decisions however large they were, and about 80 four-step reviews written in a script such as Cyrillic outgrew the size its saved history allows: the next save failed and every agent browser command in every workspace was refused until Hronaut restarted. The oldest finished decisions now make room for a new one, and a decision that still cannot fit beside the open ones is refused on its own. A history an earlier version left just under that size is trimmed the same way when Hronaut starts, so it no longer fails again after every restart.
- `browser_public_outcome` no longer fails with "Agents are paused for this target" whenever any tab in Hronaut is paused, such as a tab you paused in your own workspace. It looked for the writer tab in the observer workspace, so a single paused tab anywhere blocked every call. A writer tab you paused or took over is still refused.
- Filling a saved password no longer fails when the system's secure storage asks Hronaut to re-encrypt it with a newer key and that fails, for example because the disk is full. The password, which had already been read, is filled and keeps its previous encryption until the next fill tries again. The fill used to fail with the secure storage's own untranslated error.
- **Memory Saver** no longer puts a tab to sleep as soon as you leave it after you had it in view for longer than its timeout, such as a page you read or watched for an hour without clicking or typing in it. Switching to another tab, closing split view or pairing another page in split view now starts the tab's inactive time; it used to count from when you last showed, clicked or typed in it, so the tab slept within half a minute and loaded again when you came back.
- Archiving or closing a workspace no longer pushes tabs you closed in other workspaces out of **Recently closed**. Closing the workspace's own tabs filled the list of 50, so the oldest tabs closed elsewhere could no longer be reopened with **Reopen Closed Tab**, **Ctrl/Cmd+Shift+T** or **Search tabs**, although the workspace's own entries leave the list again.
- On **Home**, the keyboard focus comes back to the button you pressed once it is done waiting: the button that opens the full guide, **Open in VS Code**, **Troubleshoot connection**, the button that reports setup trouble and **Use port**, also when you come back to Hronaut after the guide or VS Code opened in front of it, and **Set up Claude Code** when preparing the change fails, or the setup command when the button is no longer offered. It used to fall to the top of the page while the button waited, so the next Tab started over and a button offering to retry could not be pressed again straight away. **Troubleshoot connection** also no longer disappears while it is opening the guide.
- Holding Enter in **Set up Claude Code** on Home can no longer add Hronaut to Claude Code without a deliberate choice. Once the change is ready, the keyboard focus moves to the change it shows instead of **Apply change…**, Cancel leaves it on the setup command instead of **Set up Claude Code** (or **Update Claude Code**), and the confirmation now keeps the file as it is when you press Enter: choose **Add to Claude Code** to make the change. A key held on **Set up Claude Code**, or on the first-run offer, could otherwise press **Apply change…** and then confirm it.
- Importing cookies from Chrome or Chromium into a workspace now brings over sign-ins whose cookies expire at a fraction of a second, which most login cookies do. Hronaut read their expiry a tiny bit off, so it reported most of them as **Failed** even though they were saved, and when you chose both a site and one of its subdomains, such as `example.com` and `accounts.example.com`, it skipped the second as if a page had already signed in there, which could leave you signed out. A cookie that the other browser keeps for more than 400 days, longer than Chromium allows, such as one from Firefox, now imports to expire after 400 days, as Chromium would keep it, instead of being reported as failed.
- In **Site storage**, deleting a cookie row now deletes only that cookie. A site can set several cookies with one name, on different paths or domains, each shown as its own row; deleting one deleted all of them, including HttpOnly ones the panel protects, and **Clear** took those HttpOnly cookies along too, which could sign you out.
- In **Site storage**, changing the value of a cookie row and choosing **Update** now changes that cookie. It wrote a new cookie of that name on the site's own host at "/" instead, which for a row on another path or a parent domain left the row unchanged and replaced a different cookie, and a row beside an HttpOnly cookie of the same name could not be updated at all. `browser_storage` `set` also accepts `cookieDomain` and `cookiePath` to change one existing cookie this way, keeping its domain, path, Secure, SameSite and expiry.
- `browser_resize` now offers widths from 320 and heights from 240 up to 3840 CSS pixels, the largest viewport it can apply. Its input promised up to 7680 × 4320, but any size above 3840 either way failed with a viewport error.
- Pressing Escape in the main window now closes what is open there before a panel in its own window. With panels opening in their own window, Escape typed in **Find**, **Zoom**, **Downloads** or **History** closed **Site storage** or **Site controls** there instead and left the bar or panel open, Escape in **History** closed **Bookmarks** the same way, and Escape closed any panel in its own window before the update notice, the split view menu, or an area capture or element pick that it should have cancelled. Once nothing else is open in the main window, Escape still closes the panel in its own window.
- Holding Enter on a button that asks before a change Hronaut cannot undo, or pressing Enter twice quickly, can no longer confirm the change. Removing a wallet, revoking an MCP capability profile, deactivating the license, turning off MCP authentication, clearing history, browsing data or a site's storage, moving workspace data, and deleting or permanently clearing a workspace, also from Home, asked with a dialog whose OK was the button Enter pressed, labeled in English. The dialog now has Cancel as its default button and speaks your interface language: Enter never chooses OK, Escape chooses Cancel, and going ahead takes choosing **OK**.
- An agent that bookmarks a page you already bookmarked no longer renames your bookmark. `browser_bookmarks` `add` replaced its title with the one the agent sent, or with the page's address when it sent none, so a bookmark you called "My bank" could become its URL; the bookmark now stays as it is, and agents change a title only with `rename`.
- Archiving two workspaces at the same time, such as one you archive while an agent saves another, can no longer leave more than 50 archived workspaces, which stopped Hronaut's next start with a recovery notice. When both needed the last archive place, both were archived; now the second is refused with the archive limit and stays open.
- A bookmarks file Hronaut cannot read, such as one cut short by a disk error or a sync tool, or one written by a newer Hronaut, is now kept: it stays in place until you save a bookmark or create a collection, which first renames it to `bookmarks.json.unreadable-<UTC time>` in the profile folder; if that save fails, as on Windows while a sync tool holds the file, the next one does. Hronaut started with no bookmarks either way, but the next bookmark you saved replaced the file and every bookmark in it was gone.
- Importing a workspace template that needs more tabs or open workspaces than Hronaut has room for now stops before anything is created and says how many tabs and workspaces it needs and how many are free. It used to create workspaces and open start pages until it hit one of these limits, then remove them all again and show only that the import did not finish.
- **Close other tabs** and **Close tabs to the right** no longer wake sleeping tabs only to close them. When the tab you were looking at was among those closing, it closed before the tabs after it, and each sleeping one was shown in turn, loading its site again, before it closed too; the shown tab now closes after the others and hands over to a tab that stays open. **Close duplicate tabs** does the same. As a result, **Reopen closed tab** now brings back the tab you were looking at first, and when a page asks to stay, the tab you were looking at stays open with it.
- Restricting a workspace to **Only listed sites** now replaces every page outside the list with a blank page, without the old page's title or icon. A sleeping tab on such a page kept it and opened it again when woken, and archiving the workspace then saved that address, so restoring it was refused every time; a page outside the list that was still opening when you saved the rules went on to open; and a page that asks before you leave, such as an editor with unsaved text, stayed open while the rules were saved as if it had been replaced. Allowed pages that are still opening or waking up are left to finish.
- Memory Saver no longer puts a tab to sleep, and throws away what you typed, while the draft is in an embedded page or inside a web component. It checked only the page's own form fields and editors, so a comment box in an embedded frame, such as a support chat or a third-party comment widget, or a field built as a web component counted as untouched; it now checks embedded pages and fields in open shadow roots too. An embedded page that cannot answer within a second, such as one not allowed to run scripts, is still not checked, so it cannot keep a tab awake for good.
- Closing a panel right after moving it to its own window no longer opens that window anyway. The first time a panel moved to its own window after Hronaut started, closing it in the moment before Hronaut created that window, while it read the window's saved size and position, left the window to open moments later, showing a panel the main window had already closed. Closing the panel while its window was still loading no longer shows "Browser action failed" with the load error and the folder Hronaut is installed in, or puts the panel back where it was docked before; it closes, as it does once its window has loaded.
- Site access now refuses a rule with a `*` anywhere other than the start of a subdomain rule or the port of a loopback host, such as `http://*.localhost:*` or `https://a.*.example.com`, and says where a `*` can go. Such a rule was saved as written and never matched a site, so a workspace limited to it blocked the sites it seemed to allow. A rule like this saved by an earlier version is dropped when Hronaut starts, which changes nothing the workspace allows; a public observer workspace whose origin was such a rule stays limited, to no site.
- Waking a sleeping tab keeps the pages before it in the tab's history. Waking loaded the page again after Hronaut's own blank "Sleeping tab" page, so Back opened that page instead of the one you came from, and in a workspace limited to listed sites Back did nothing; duplicating the tab copied that page too. Pages you had gone back from before the tab slept are still not kept. Like Back, and like Chrome when it wakes a tab, waking now takes the page from the browser's cache when it has a copy, unless the site asked not to keep one.
- Holding Escape a moment too long no longer closes more than one thing. Once the first press had closed something, the key's repeats went on to close the next open surface, so holding Escape to close Find also closed Site storage in its own window, and holding it to leave a Tab search page preview closed Tab search; now only the first press does anything.
- Holding Enter on a row's remove button in **Bookmarks**, **History**, **Downloads** or saved passwords, or on **Forget** in site permissions, now removes only that row. The button hands the keyboard focus to the next row's, so each repeat of the held key removed one more row: holding Enter for a second on one bookmark removed all six. Removing the last row no longer closes the panel too, and holding Enter on a download's cancel button no longer also removes it from the list. Pressing Enter again still removes the next row.
- Removing an entry in **History** now moves the keyboard focus to the next entry's remove button, as **Bookmarks** and **Downloads** do. History's updated list arrived before the removal finished, while the other entries' buttons were still unavailable, so the focus often went to the search field instead.
- Holding Delete on a focused tab now closes only that tab, and holding M mutes or unmutes it once. A closed tab hands the keyboard focus to the next tab, so each repeat of the held key closed one more tab, and holding Delete for a moment closed every tab after it. Ctrl or Cmd with Shift and Delete on a focused tab now opens **Workspaces & data** instead of closing the tab.
- Holding Enter to validate a wallet import no longer adds the wallet before you see its review. **Validate and review** hands the keyboard focus to **Add encrypted wallet**, so the held key's repeats added the wallet before its address could be checked; adding it now takes a new press.
- Holding Enter to fill a saved password on a site with more than one saved account now leaves the choice of account to you. The account picker opens with the keyboard focus in its search field, so the held key's repeats filled the first account into the page.
- Imported wallets in **Settings > Wallets** now show **Imported wallet** as their kind, in every language. The list showed the untranslated text `wallets.kinds.imported` instead.
- Holding Enter on **Hand back** in the pinned live status no longer pauses or takes over from the agent you handed back to. Hand back hands the keyboard focus to **Take over** or **Pause**, so the held key's repeats pressed it, and **Take over** paused the agent and took its tab. Holding Enter on **Pause**, there or in an agent's card, or on one of the card's switches, now changes it once instead of on every repeat, and holding Enter on the card's close button or on **Unpin** no longer opens the card again from the agent's avatar.
- Holding Enter on a tab's close button in **Tab search** now closes that tab and stays in Tab search. Closing it puts the keyboard focus in the search field, so the held key's repeats went on to open the selected result, which closed Tab search, and then opened Tab search again from the toolbar, over and over until the key was let go. Holding Enter on **Search tabs** in the toolbar, on Tab search's close button or on the palette's **Search tabs** command no longer loops the same way, holding Alt and Enter opens a page preview once instead of opening and closing it on every repeat, and holding Enter on a tab's **⋯** menu or one of its items no longer pins the tab.
- Holding Enter on **Switch workspace**, the palette's **Switch workspace** command or the command palette button now leaves the choice to you. The switcher and the palette open with the keyboard focus in their search field and a choice already selected, so the held key's repeats switched to another workspace or ran the first command. Holding Enter to close them, or on a command, no longer opens them again from the button they give the focus back to.
- **New workspace** in the workspace switcher now opens the workspace editor. It closed the switcher and nothing opened, because the editor still saw the switcher as open.
- A tab an agent just opened or acted on now gets its preview in the tab overview. When the picture of the agent's step was being taken at the same moment, the tab's own capture got nothing and was not tried again, so the overview could show no preview for the tab until its page changed.
- Holding Delete to close the active tab no longer deletes text in the next tab's page. The tab that takes its place gets the keyboard focus, and the held key's repeats went on to that page, where they could delete the text in its focused field. A key held down in the shell no longer repeats into the page it hands the focus to, and a key pressed in the page still repeats as before.
- Holding Enter on **Archive** in a workspace card's menu on Home now leaves the workspace archived. Archiving moves the keyboard focus to **Undo**, so the held key's repeats pressed it and restored the workspace. A held Enter on Home's workspace buttons and card menus now presses them once.
- **Set up Claude Code** in Home's first-run panel now puts the keyboard focus on the change it shows, as the same button in **Connect an agent** does. The first-run button hid with its panel but kept the focus for a moment, so the change sometimes did not take the focus, and the focus went to the top of the page.
- Counts now use the word form each number takes, such as 2 файли cookie, 5 кадров or 2 żądania in Polish, Russian and Ukrainian, and 1 tool, 1 request or 1 saved account in English, which read 1 tools, 1 requests and 1 saved accounts. This covers Site controls, Home, Privacy settings' website list, the Page tools labels, the quality, accessibility, performance and DOM changes reports, the Environment panel, address suggestions, Memory Saver's summary and the saved-passwords import dialog. A label with two counts, such as the quality check's errors and warnings or a site's history pages and visits, now gives each count its own form: it read "1 errors · 3 warnings".
- Dates and decimal numbers now follow Hronaut's interface language in wallet approvals and wallet settings, MCP capability expiry, the incident package review, the workspace navigation audit, PWA lifecycle events, Network durations, the storage quota share, layout shift scores and video timings. Dates there used the system's format, so with a Ukrainian interface on an English system a wallet approval's expiry read 1/15/2027, 8:00:00 AM; English dates there now name the month. Decimals always used a point, so German showed Network durations as 1.25 s.
- French now writes a count of 0 in the singular, as French grammar does, such as 0 onglet or 0 erreur. It read 0 onglets and 0 erreurs.
- A screen reader now reads the agent card in Hronaut's interface language. The card is drawn in its own view, whose page always said it was English, so a Ukrainian or German card was read with English pronunciation.
- A saved-passwords file Hronaut cannot read, such as one cut short by a disk error or a sync tool, or one written by a newer Hronaut, is now kept: it stays in place until you save or import a password, which first renames it to `credentials.json.unreadable-<UTC time>` in the profile folder. Hronaut started with no saved passwords either way, but the next password you saved replaced the file and every password in it was gone. To use the kept file again, for example in the newer Hronaut that wrote it, quit Hronaut and rename it back to `credentials.json`; it replaces the passwords saved since. It holds the sites, usernames and encrypted passwords, so delete it once you no longer need it.
- An address on the local network typed or passed to `browser_navigate` without `http://`, such as a development server's Network address `192.168.1.20:5173`, a Tailscale `100.x` address, `host.docker.internal:3000` or `nas.local`, now opens over HTTP, as `localhost` does. It opened over HTTPS, which such a server usually does not serve, so the page failed to load. Public addresses, and any address that names port 443, still open over HTTPS.
- A PDF, screenshot or HAR saved from a page whose title starts with a dot, such as ".NET documentation", is no longer hidden on macOS and Linux: the leading dot is left out of the file name. `browser_pdf_save`, `browser_screenshot_save` and `browser_network_har` now refuse a requested file name that starts with a dot, which was hidden too, and `.pdf` alone saved a second copy named `.pdf (1)` with no extension.
- A download from a `data:` address, such as a CSV or image a page generates with a download link, no longer keeps the whole file in its download record. `browser_downloads` returned the file's full contents as the download's `url`, a 600 KB base64 CSV as about 800,000 characters, with every list, pause or cancel, and the download panel received it again on every progress update. The record now keeps only the media type, such as `data:text/csv,`, and any other download address is cut at 4,096 characters.
- A download whose suggested name is longer than many file systems allow, 255 bytes, such as a long title in a server's file name header or about 130 Cyrillic letters, is now saved under a shortened name that keeps its extension. Hronaut used the whole name, so the file could not be created and the download stopped as interrupted, and Resume tried the same name again.
- A second download of a compressed archive such as `release.tar.gz` is now saved as `release (1).tar.gz`, as Chrome names it. Hronaut named it `release.tar (1).gz`, which unpacks to a file without its `.tar` extension. The same holds for `.tar.zst`, `.tar.xz`, `.sql.gz` and similar names.
- A one-word machine name with a port typed or passed to `browser_navigate`, such as `devbox:3000`, a Tailscale MagicDNS name or `nas:5000`, now opens that website over HTTP. Hronaut read `devbox:` as a URL scheme, so the tab refused the address as one a workspace cannot open. Short number links such as `tel:911` and a number before the colon, such as `16:9` or `10:30`, are still not read as a machine name.
- Passwords exported as CSV from Bitwarden or KeePass now import. Settings suggests exporting from another password manager, but Bitwarden names its columns `login_uri`, `login_username` and `login_password` and KeePass names its user name column `Login Name`, so Hronaut refused the file for missing url, username and password columns. Hronaut now also reads those, and the other column names Chrome's own import reads, such as `hostname` and `account`; a file that imported before reads the same columns. A Bitwarden login that lists several websites is saved for each of them, up to ten.
- On macOS, Control with a letter or another key now stays with the website or the field you are typing in instead of acting as Command. Control+F opened Find instead of moving the caret in a text field, Control+D added a bookmark instead of deleting forward, Control+K in the address bar opened the workspace switcher, and in a web terminal Control+W closed the tab and Control+R reloaded it. As in Chrome, Hronaut's browser keys on macOS use Command without Control; Control+Tab still cycles tabs and Control with a number-row digit still goes to a pinned workspace. Command+Control+F, the macOS full screen key, no longer opens Find.
- Right-clicking Hronaut Home no longer offers **Inspect**, which opened Developer Tools on Home's own page although F12 and the other Developer Tools keys refuse there. Home's page holds Hronaut's privileged Home controls, so it has no Developer Tools, whichever action asks.
- Turning the mouse wheel with Ctrl held now zooms the website on Windows and Linux, one step per notch, as in Chrome. It did nothing: the page stayed at its size. A page that uses Ctrl with the wheel itself, such as a map or a design tool, keeps it, and Hronaut Home keeps its size.
- **Save page as PDF** now uses the standard paper of your region: A4 in most of the world, and Letter in the US, Canada, Mexico and the other countries that use it. It always used Letter, so a page saved in Europe or Asia came out with cut edges or shrunk when printed on A4. Agents' `browser_pdf_save` still uses Letter unless it names a paper size.
- Typing a number such as `3.14`, `2.0`, `1.2.3` or `22.5/7` in the address bar or a new tab, or giving one to `browser_navigate`, now searches for it, as Chrome does. Hronaut read it as a short IPv4 address and opened that server, so `3.14` went to `https://3.0.0.14` on the internet. A full address such as `8.8.8.8`, a number ending in a slash such as `1.2/`, and a local address with a port or path such as `10.5:3000` still open.
- **Save Image** and **Save Link** in a website's context menu now send the page's origin as the referrer, so they work on sites that serve their images and files only to their own pages, such as many image hosts and galleries. Hronaut sent no referrer, so such a site refused the request and the download failed. The page's referrer policy still applies: a page that sends no referrer, a sandboxed frame, and an HTTPS page saving from an address that is not HTTPS send none, and only a page whose policy sends its full address to every site sends more than its origin.
- A website that updates its own history entry without changing the address, as single-page apps do with `history.replaceState` to keep a scroll position or router state, no longer adds a visit to Hronaut's history each time. One load of such a page could show "11 visits" in History, jump to the top of History and address suggestions while in the background, and rewrite the history file each time. Like Chrome, a page changing its own state is not a visit; only a change to another address, route or section counts.
- Clearing your history now also forgets your recently closed tabs, as Chrome does. **Clear all** in History, clearing history in Privacy settings, or an agent clearing it left every closed tab's title and full address in Tab search's **Recently closed**, ready to reopen with Ctrl/Cmd+Shift+T, and in agents' view of the workspace. Removing one page from the history, or clearing one website's, forgets the closed tabs that showed it.
- The history no longer saves the fragment of an untitled page's address as its title. Chromium names a page without a title by its address as it shows it, with the fragment and often without the scheme, such as `app.example/oauth/callback#access_token=…`, so a sign-in callback page saved its token in the history, its suggestions and agents' `browser_visit_history`, although the history leaves fragments out of addresses. Such a title is now the address without its fragment, also when Chromium shows the address without `www.`, with its escapes decoded or wrapped for right-to-left text, and history saved by an earlier version is repaired when Hronaut starts. An untitled page that then changes its address within the page, as a callback page can with `history.replaceState` once it has read its token, is now named by its new address in its tab, the history, saved and closed tabs and agents' `browser_tabs`; it kept the old address with its token.
- Quitting Hronaut with a download in progress now asks first, as Chrome does. **Quit** in Hronaut's menu or tray, closing the window when it does not hide in the tray, and restarting to install an update, including restarting on Linux into a version your package manager installed while Hronaut ran, cancelled every download in progress and deleted its unfinished file without a word, and nothing could resume it later. **Keep downloading** is the default answer; after a package manager update, the update notice then says the new version is installed, and **Try again** restarts Hronaut once your downloads finish. A quit from outside Hronaut does not ask, such as `hronaut --quit`, **Quit** in the macOS Dock, or the computer shutting down, unless the system closes Hronaut's window first, as some Linux desktops do at logout. On macOS, restarting to install an update also no longer stops when the window hides in the tray instead of closing.
- A finished download whose file was moved or deleted now reads **Moved or deleted** in the Downloads panel, struck through as in Chrome, without **Show in folder** or **Copy saved path**; Hronaut checks each finished file, one at a time in the background, when the panel opens or a new download starts, and a file put back reads as finished again. The panel used to call such a file complete, and **Show in folder** then failed with an English error. That error and the panel's other download errors, such as pausing a download that has just finished, now appear in your interface language, and agents' `browser_downloads` keeps its messages and marks such a record `fileRemoved`.
- **Save Link** in a website's context menu now saves a link with a `download` attribute under that name, as Chrome does, such as `report.csv` for a link to `/export?id=5`. Hronaut saved it under the name from the address instead, here `export.csv`, since the request Electron starts for the save cannot carry the name. A name the server gives the file still comes first, and a link that redirects to another site keeps the name from the address, as when you click it.
- Holding Enter on **Replay XHR** in the Network panel, or double-clicking it, no longer replays a POST, PUT, DELETE or other request that can change data without the second press it asks for. The first press turned the button into **Confirm replay POST** (or the request's method) and kept the focus there, so the key's repeats, or the double-click's second click, confirmed it and the request was sent again. Confirming now takes a new press or click.
- A website's permission prompt, such as for location or the camera, now closes by itself once its tab closes, the page or frame that asked loads another document, for example when you reload it, even if the reload ends on an error page, or the page removes the frame that asked. It stayed open until answered, and every other prompt, from any tab, waited behind it, including the same page asking again; the answer it took was then ignored. The request is refused, and nothing is saved.
- A request that failed before its response now has its duration in `browser_network`, its details and the Network panel's Duration sort, measured by Chromium's clock from its start to its failure. It has no resource timing, so agents got no `durationMs`, and sorting by duration put it among the unmeasured requests after all the others, though its row showed a duration: a request that hung for 30 seconds before failing came last when sorting by the longest first. A request recorded without its duration, as when the Network debugger is not attached, now sorts by the time from its start to its end, as its row shows it.
- The Network panel now lists the page's requests when it opens from **Request conditions**, in Page tools, the address bar or the command palette, and when it docks back from its own window. It said no requests were captured yet, or kept the list it had before it left, until you pressed **Refresh**; only its **Network** button in Page tools and the command palette's Network command read them.
- The Network panel now says in the interface language, and in words for a person, when a request has left its log, the page changed while the panel read it, a replay needs a reload, cannot be made or was not seen to finish, or a request cannot be copied as cURL or PowerShell, and what to do instead. It showed these in English, in the words agents read, which agents still get unchanged. Request conditions' **Response headers** field now says it needs a JSON object when its text is not JSON, instead of the parser's English message.
- Request conditions in the Network panel now say in the interface language what to fix when a URL pattern has no scheme or contains a control character, a response header's name or value has a character HTTP does not allow, a mock response has too many or too long headers or a body over 512 KiB, the tab already has 50 conditions or is Hronaut Home, and when a condition was removed meanwhile, for example by an agent. They showed English error text written for agents, Node's own header message or, for a long body, a raw schema error.
- `browser_network_routes` now tells an agent why it refused a change before sending anything, in a `message` beside `status: "NOT_DISPATCHED"`: for example a URL pattern without a scheme, a response header HTTP does not allow, a tab that already has 50 rules, an unknown or missing `routeId`, or a missing `urlPattern`. It answered every such refusal with "No configuration command was submitted. Inspect current authority and application health before proceeding." A review that could not be finalized after such a refusal now also reports `reviewFinalization: "failed"`, as `browser_emulate` does.
- **Site storage** now shows the site's storage as it is now when it docks back from its own window. It showed what it had before it left, including items deleted or changed meanwhile.
- **Environment** and **Responsive preview** now show the tab's settings as they are when they dock back from their own window. They kept the draft from before they left, so **Apply** or **Apply preview** could undo what was applied in the window.
- **Visual compare**, **Issues**, **Code coverage** and **JavaScript CPU profile** now read the tab again when they dock back from their own window. They showed what they had before they left, such as no baseline after one was set there, or a recording as stopped while it ran.
- Audits and reports (**Quality audit**, **Accessibility**, **Performance**, **Design overview**, **Page metadata**, **Connection security**, **Memory** and **Debug report**) now run for the page shown when they dock back from their own window with no report, for example after the tab navigated or another tab was selected while they were there. They showed no report and nothing to run it with until closed and opened again.
- **Site controls** now show the site's cookie and history counts when they dock back from their own window after the tab navigated or another tab was selected while they were there. They showed "…" until closed and opened again.
- A file access prompt that names no file no longer says both that Hronaut remembers the choice and that it asks again next time.
- The Network panel now names request types, response sources, initiators and WebSocket messages in the interface language, in the request list, request details and content search. A German panel showed Chromium's English codes, such as `fetch/xhr`, **Disk cache** and `received binary`. In English, a row's type now reads as its filter chip does, such as **Fetch/XHR** or **JS**, and the details name types and initiators as words, such as **Script** or **Signed exchange**. Filters, HAR files and MCP results keep the codes, and the filter box still matches the English names.
- Text Hronaut adds only in some cases no longer runs into the words before it. A WebSocket frame read "Payload omitted for binary(opcode 2).", a request condition "Fail as Failed· until removed", and **Code coverage** "precise mode· bounded result". The Network panel's message counts, copy note and search summary, Site storage notes, the **JavaScript CPU profile**'s page-changed note, the Design overview's large-text note and the command palette's and tab search's spoken selection lost the space before them too.
- The Network panel now says in the interface language why it shows no body, such as a binary or multipart body Hronaut withholds or a response body that has not completed, and names where content search found a match, such as **Response body** or a received WebSocket text message. In English the withheld body reads as a sentence, such as **Binary body omitted.**, instead of `[binary body omitted]`. MCP results, HAR files and copies keep the English notes.
- The Responsive preview's viewport presets, such as **Compact phone**, and the search engine descriptions in **Settings → Search engine** now appear in the interface language. A German preview listed the presets in English next to its translated **Benutzerdefiniert** preset. Engine names stay as they are.
- **Page performance**, **Accessibility**, **Connection security** and the **Debug report** now show ratings, states and types in the interface language instead of the codes web-vitals, axe and Chromium report. A German **Page performance** panel rated LCP `needs improvement` and named script work `event-listener`; it now reads **verbesserungswürdig** and **Event-Listener**, and user timings read **Marke** or **Messung**. Accessibility violations show their impact and the audited standard as words, such as **schwerwiegend** and **WCAG A und AA**; **Connection security** names its state and certificate transparency, such as **nicht sicher** and **Nicht konform**, also in Page tools; and the **Debug report** names console levels and request types as the Console and Network panels do. In English, the security badge now reads **not secure** instead of `insecure`, certificate transparency **Compliant** instead of `compliant`, the standard **WCAG A and AA** instead of `wcag-aa`, script work **event listener**, and Debug report request types **Fetch** or **Script**. MCP results and copied reports keep the codes.
- The **Issues** panel now names each Chromium issue in the interface language, such as **Unsicherer gemischter Inhalt** or **Cookie-Kompatibilitätsproblem** in German, instead of English headlines such as "Insecure mixed content". The issue code under the headline, copied issues and MCP results stay English. An issue code Hronaut doesn't know still gets a headline made from its code, now also for a code named like a built-in object property, which before got no headline or severity in the panel or in MCP results.
- The **Repro recorder** timeline now names each step and its action in the interface language, such as **Klick** and **button „Sign in“ anklicken** in German, instead of `click` and "Click button “Sign in”". Page labels, element names, addresses and keys stay as recorded, and a step whose sentence was changed by redaction, such as a field labelled “Password:”, shows as recorded. MCP results, copied timelines and Playwright exports keep the English steps, and an English timeline reads exactly as they do.
- **Site storage** (its tracked changes, and the service workers and their history on the **Offline** tab), **DOM changes** and **Code coverage**, also in its **Page tools** label, now name what they report in the interface language. A German storage comparison marked rows `added` and `removed`, DOM changes read `child-list`, coverage read "Modus „block“", and the service-worker history read `statechange`, `activated` and `duration-limit`; they now read **hinzugefügt**, **Kindelemente**, **Modus „Block“**, **Status geändert**, **aktiviert** and **Zwei-Minuten-Limit erreicht**. In English, DOM changes now read **children** instead of `child-list`, and service-worker events and stop reasons read as phrases such as **state changed** and **two-minute limit reached**. An event or state a page reports that Hronaut doesn't know still shows as the page sent it. MCP results and copied reports keep the codes.
- Diagnostic text that puts an address in typographic quotes now keeps the address and its closing quote. Redaction read the closing quote as part of the address and percent-encoded it, so a **Repro recorder** step on a link labelled with its address read `Click link “https://example.test/%E2%80%9D` in the timeline, `browser_repro` results and copies, and stayed in English in a translated timeline. Console messages and incident packages quoting an address in “…”, «…» or „…“ lost the quote the same way, and one with no path, such as “https://example.test”, came out as `https://example.xn--test-jb7a/`.
- The **Quality audit** panel now shows its categories, statuses, summaries, evidence, findings and caveats in the interface language. A German audit read **Accessibility**, `warning`, "2 violations across 3 affected nodes" and "LCP is rated needs improvement at 3200 ms."; it now reads **Barrierefreiheit**, **Warnung**, **2 Verstöße in 3 betroffenen Knoten** and **LCP ist mit 3.200 ms als „verbesserungswürdig“ bewertet.** Rule names from axe, issue codes and text Hronaut doesn't recognize stay as recorded, and copied audits and MCP results stay English. In English, ratings and security states read as words, such as `needs improvement` and `not secure`, a count of one takes the singular, numbers are grouped, each finding names its category as the category cards do, such as **Chromium issues** instead of `browser-issues`, and metadata findings read as in **Page metadata**.
- **Request conditions** in the Network panel now name failure reasons in the interface language, in the **Failure reason** menu and in each condition's line, such as **Fehlschlagen: Zeitüberschreitung** in German instead of "Fehlschlagen als TimedOut". In English the reasons read as words too, such as **Fail: Timed out**, and Chromium's generic `Failed` reads **Generic failure**. MCP results, including `browser_network_routes`, keep Chromium's codes.
- **Page performance**, the **Accessibility** comparison with a baseline and the IndexedDB inspector in **Site storage** now list their notes on how to read the report in the interface language. A German panel listed them in English, such as "This is one local current-visit sample, not field data…". The IndexedDB inspector also told the person reading it to "Use browser_site_data only when the task explicitly requires clearing origin storage", words meant for agents; it now says, in every language, that it only reads IndexedDB and never changes or clears it. MCP results and copied reports keep the English notes.
- The **Repro recorder**'s selected checkpoint now names its condition as the **Condition** menu does, such as **Bedingung: Elementanzahl 3** in German or **Condition: URL pathname /orders/complete** in English, instead of the recorded code (`count`, `urlPath`), and an exact-text checkpoint quotes the text it expects. Copied timelines, Playwright exports and MCP results are unchanged.
- When an agent waits on a decision, the tab, workspace and agent tooltips, the agent card, the tray icon's tooltip and menu, and the system notification now say why in the interface language, such as **The agent wants your approval before it acts.**, instead of "Human decision required: approve-action" in every language. The agent card already did once it had read the decision. A reason an agent writes itself still shows as written. MCP results keep the English line, and the French tab tooltip now puts a space before its colon.
- **Site storage**'s **Overview**, **Changes** and **Offline** views, including the **Service-worker history**, now list their notes on how to read the report in the interface language, and a cache the page no longer has is named in it too, such as **Cache nicht gefunden: app-shell-v2** in German. A German panel listed the notes in English. Four of them also told the person reading the panel to "Use browser_site_data only when the task explicitly requires clearing origin data" or to "Request includeValues" or "includeHeaders", words meant for agents; they now say the inspector only reads and never clears, or that values or headers are left out. Chromium's own reason after a fallback or installability note stays as Chromium wrote it. MCP results and copied reports keep the English notes.
- The workspace editor now names its colors in the interface language, such as **Violett** in German, where they were "Purple" and the other English names in every language, for screen readers and in the tooltip. The **Portable workspace templates** editor lists the same names instead of the codes saved in the file ("purple"), and names a template's source platform as **macOS**, **Windows** or **Linux** instead of "macos". Template files keep the codes.
- The **Portable workspace templates** editor now says why it refuses an entry in the interface language, such as **Ungültiger Arbeitsbereichsname in der Vorlage.** in German for a cleared name, where every language read "Invalid template workspace name.", "Workspace description contains unsupported control characters." or "Template start pages require HTTP(S) without URL credentials." New entries are named in the interface language too, such as **Arbeitsbereich 1** instead of "Workspace 1".
- The **Video recorder** now says why capture paused or stopped by itself in the interface language, such as **Aufnahme pausiert, während der Computer im Ruhezustand war.** in German, where every language read "Capture paused for system sleep; resume explicitly" and the other notices in English. The English notices now speak to the person, such as **Resume the video to continue.**, instead of telling them to "resume explicitly", and stopping a recording yourself no longer leaves a note telling you to resume it. MCP results keep the English notice.
- **Settings** › **Wallets** now says why managed wallets are disabled in the interface language, such as **Die Wallet-Daten haben die Integritätsprüfung nicht bestanden.** in German, where the translated status ended in English ("Wallet data failed integrity checks. Wallet operations are disabled."). The reason now replaces the sentence about the key-protection backend, which repeated it or, after a failed integrity check, wrongly said no secure backend was available, and the English reasons are worded for people, such as **No secure key storage is available for wallets.** While wallets start, the status no longer adds "Wallet service is initializing." in English.
- The **Video recorder** now says why it refuses an edit or an action in the interface language, such as **Anmerkungen müssen in die Aufnahme passen** in German, where it showed English ("Annotations must fit inside the recording"). This covers annotations, clips, audio events and camera moves that don't fit, returning to the recording's origin, an audio file Hronaut can't read, the recording changing while you choose audio, an export that timed out and a fourth recording. MCP results keep the English text.
- The **Video recorder** now says in the interface language why it refuses an annotation, kept range, audio event or camera move that ends before it starts, such as **Das Ende der Anmerkung muss nach ihrem Anfang liegen** in German, and asks you to check the values of any other edit it refuses. The panel showed the raw list of failed checks, with entries such as `"message": "Annotation end must follow its start"`, in English in every language. An audio file the recorder cannot use, such as one that is not a PCM16 WAV, is now named in the interface language too. `browser_video` keeps the English messages.
- Websites can now read a file you drop on them or pick in their **Open** dialog, such as in an online editor, and a folder you pick and allow: reading failed with `NotAllowedError`, and a picked folder failed even after you chose **Allow**. A file or folder a website keeps, such as one it stores to reopen your recent files, stays readable after the page reloads or Hronaut restarts, and the prompt for reading a folder says so. A website you let change a folder can save inside it until the page reloads. A call page you let use your camera or microphone now sees them as allowed, with their names, so it can list and switch devices, where it saw them as blocked. Electron cannot ask before a website writes a single file you opened or dropped, so that is still refused. File access prompts no longer say their decision applies only once.
- A website no longer waits forever after you pick a location Chromium protects in its picker, or drop such a folder on it, such as your whole Documents or home folder, a system folder, `~/.ssh` or Hronaut's own data. Hronaut says the website can't use it and lets you choose another folder or file in the picker, or cancel; it never gives the website that location, and a dropped folder is refused either way.
- Saving over a file in a website's **Save** dialog (`showSaveFilePicker()`) no longer leaves it empty. Chromium empties the file you pick before the website writes to it, and Hronaut then refused the write, so the website reported an error and the file stayed empty. The website can now save to that file while Hronaut runs, as in Chrome, unless it had already read or tried to write that file, such as one you opened in it: it then saves there once, and you pick the file again for the next save or turn on **Let websites save to files you open or drop**.
- **Settings → Downloads** now says in your interface language why it could not create or open the download folder, such as Hronaut having no permission there, a full disk, a read-only or missing drive, or a file in the way, and includes the code, such as EACCES. It showed the system's English error with the folder's whole path, such as `ENOTDIR: not a directory, mkdir '…'`, or the file manager's own English text. Choosing a folder while the Hronaut window is unavailable is translated too.
- A website's sign-in popup, such as **Sign in with Google**, now works. Hronaut opened the popup in a new tab but gave the website no window for it, so `window.open()` returned nothing, many sites said the popup was blocked, and the popup could not send the result back through `window.opener`. The popup still opens as a tab of the same workspace, with its sign-ins, and stays open if the page that opened it closes. When the popup closes itself, its tab now closes too and Hronaut shows the tab that opened it, where it used to say its page was no longer available. While both are open, the popup and the tab that opened it stay awake. As in Chrome, a popup and its opener on the same origin (scheme, host and port) can read each other's pages, and pausing one does not pause the other, so pause both before typing anything the agent must not read.
- When a workspace other than the first has a pinned tab, tab shortcuts and the tab shown after you close one, or put one to sleep, now follow the tabs on screen. Hronaut put every pinned tab before every workspace's other tabs, so closing a tab could show a tab of another workspace instead of the one beside it, and **Ctrl/Cmd+1** to **Ctrl/Cmd+9** and **Ctrl+Tab** went by that order.
- Hronaut now keeps when each workspace was last used across a restart. Putting the saved tabs back at startup counted as using every open workspace, so after each restart Home's workspace cards all read **Last used now**, and the workspace switcher and **Alt+0** (**Control+0** on macOS) lost which workspace you or an agent used last.
- When you close the tab on screen and it is the last of its workspace's tabs in the strip, or the bottom one with vertical tabs, Hronaut now shows the tab beside it in the same workspace, as Chrome does in a tab group. It showed the first tab of the next workspace instead, so you landed in another workspace with its own sign-ins, and **Close Other Tabs**, **Close Tabs to the Right** and **Close Tabs Below** could do the same when the tab on screen was among those closed. **Put Tab to Sleep** on the tab on screen now also shows another tab of its workspace, waking it if needed, and moves to another workspace only when its own has no other tab.
- **Clear history** now removes the visits in the history file even when Hronaut could not read that file, such as one saved by a newer version or a damaged one, and so does clearing one website's history. Hronaut then listed no history and wrote nothing on clearing, so the visits stayed on disk until the next page you visited replaced the file.
- **Import from browser…** no longer gets stuck when you click **Continue** more than five minutes after opening it, for example after closing the source browser as an error asks, or after the workspace changed. Every **Continue** then said the preview had expired until you cancelled and opened the import again. Hronaut now lists the profiles again and goes on with the one you chose, or asks you to choose again when it cannot tell which one that was.
- A sleeping tab whose website cannot be reached, such as a local dev server you stopped, now opens on the browser's error page for its address, as in Chrome, so **Reload** tries again. Selecting it failed with "The website refused the connection" and left the other tab on screen, and closing the tab beside it failed the same way.
- **Import from browser…** now finds Firefox profiles kept in your configuration folder (`~/.config/mozilla/firefox`, or where `XDG_CONFIG_HOME` points), where Firefox 147 and later put them for a new install. Those profiles were missing from the list, so with no other browser installed it said no supported browser profiles were found.
- **Reopen Closed Tab** (**Ctrl/Cmd+Shift+T**) no longer gets stuck after you restrict a workspace's **Site access** rules. When the most recently closed tab was on a site the new rules refuse, every Ctrl/Cmd+Shift+T failed with that site being blocked, and the older closed tabs, even those of other workspaces, could not be reopened with it. Closed tabs on pages a workspace's new rules refuse now leave **Recently closed**, as the denied pages of its open tabs are replaced.
- **Undo** after closing or archiving a workspace now brings it back as it was: in its place in the tab rail, pinned with its keyboard shortcut if it was, on the tab you were on, and with the tabs you had closed in it back in **Recently closed**. It came back at the bottom of the rail, unpinned, on its last tab, and those closed tabs were gone. Archiving a workspace also keeps which tabs had their zoom set apart from the site's other tabs and each tab's font size, and restoring it from the archive later shows the tab you were on; both were lost.
- When the tab a workspace last showed is closed while you look at another workspace, for example by an agent, going back to that workspace now shows the tab that closing it on screen would show: the tab that opened it, for a popup such as a sign-in window, or else the tab beside it. It showed the workspace's first tab, and agent commands without a tab ID used that tab too.
- A tab you muted now stays muted when it comes back: with **Reopen Closed Tab** (**Ctrl/Cmd+Shift+T**) or **Recently closed**, with **Undo** after closing it, and when its workspace is restored from the archive, with **Undo** after closing or archiving it, or after closing it failed; a duplicate of it is muted too. It came back with sound, although a restart kept it muted.
- With **Follow agents** on, an agent working in the tab you show beside yours in split view no longer takes over your pane. Its calls, once you had paused for a few seconds, made the agent's tab the active pane and moved keyboard focus out of your page, so what you typed next went nowhere, and the address field, the toolbar and Ctrl/Cmd+W then acted on the agent's tab. Follow now leaves a tab that is already in view as it is, and a call on such a tab no longer lets another agent's running call take the view a few seconds later after you used your page.
- In split view, clicking the other pane's page now cancels a sleeping tab you picked that is still waking, as clicking the pane's marked tab already did. The sleeping tab used to replace your split view once it woke, and took keyboard focus while you worked in the pane.
- A sleeping tab you picked no longer replaces the split view you open while it still wakes. And opening a split view with a sleeping tab no longer reports an error when you picked another tab or closed one of the two tabs while it woke, such as a failed page load for the tab you closed; the split view you no longer wanted stays closed without a message.

### Security

- With **Follow agents** on, an agent no longer learns which tab Follow shows, or the name of the agent it follows, when that tab belongs to another workspace. `browser_status` and the other tools that return a workspace's state included both, and tools that return the browser state after an action, such as `browser_navigate`, `browser_select_tab` or `browser_close_tab`, also included another workspace's split view, so an agent could read the IDs of another workspace's tabs and which agent was working there. An agent still sees Follow and split view when they show its own workspace's tabs.
- `browser_storage` no longer deletes HttpOnly cookies. Deleting cookies by name, or clearing them, removed each one through Electron's cookie removal, which also took any HttpOnly cookie of the same name that the page receives, such as a sign-in on a parent path, and the parent domain's own host-only cookie of that name, which the tab never receives. Each cookie is now expired by its exact name, domain and path, and Chromium never lets that replace an HttpOnly cookie.
- `browser_site_data` clearing an origin's cookies no longer removes cookies that only its sibling subdomains or the parent domain receive. Clearing `https://app.example.com` removed the cookies of every `example.com` address, such as an HttpOnly sign-in on `admin.example.com`, and cached HTTP sign-ins for all of them, because Chromium clears cookies for a whole site; an agent allowed only that origin could do it, and the result, which counts only that origin's cookies, did not show it. Now only the cookies that origin receives are removed, including Secure cookies of a local address such as `http://localhost:3000`, which Chromium sends them to. A cached HTTP Basic or Digest sign-in now stays, since Electron cannot clear one for a single origin.
- Creating a workspace as a copy of another now keeps the **Only listed sites** rules you chose for it. They were replaced by the source's rules, so a copy of a workspace that allows every site, made with agent access on, let agents open any site; rules the source also lists are now kept, and any other rule is refused with a message instead of being replaced.
- In **Edit workspace**, turning on agent access together with a change to the Site access rules now turns access on only after the rules are saved. When Hronaut refused the rules, such as one with a path, agent access was already on under the workspace's old rules, which could allow every site, while the editor showed only the error. Now agent access stays off when the rules are refused, a refused name saves nothing, and turning agent access off still happens before looser rules apply.
- A website no longer gets the effect of a click every time one of its pages loads. Hronaut starts watching each page for unsaved edits, and it did so as if you had clicked the page, so right after loading a page could use what browsers keep for after a click, such as entering full screen.
- `browser_workspaces` no longer creates a public observer workspace for an `observerOrigin` such as `https://*.example.com/`. That origin became a subdomain wildcard, so the observer, meant to be limited to one site, allowed every subdomain.
- A signed storage or download link's signature is now redacted in the addresses Hronaut sanitizes for agents and diagnostics: download records and `browser_downloads`, network request addresses and their redirect, referrer and content-location headers, form-encoded network request bodies, debug reports, page snapshots and sanitized URL and cURL copies. The `sig`, `Signature`, `jwt`, `q-signature`, `hdnts`/`hdntl`/`hdnta` and `x-…-signature` values of Azure shared access signature, CloudFront, older S3 and Google Cloud Storage, Tencent COS, Akamai token, Alibaba OSS, GitHub release asset and similar links were kept, so anyone who read them could open the file until the link expired. S3 SigV4 and Google Cloud Storage V4 links were already unusable, since their credential was redacted. Other query values, such as an expiry time, stay readable.
- API keys, sessions and passwords in a few more common forms are now redacted wherever Hronaut sanitizes addresses and form bodies for agents and diagnostics, such as `browser_downloads`, network request details, HAR exports and page snapshots. A Google API `key`, `access_key`/`accessKey`, an API Management `subscription-key`, `auth`, a `sid` or `PHPSESSID` session, a Java session kept in the path (`;jsessionid=…`, also in a relative redirect and with URL detail omitted), and a `pwd` or `passphrase` field were kept: a WordPress sign-in posts its password as `pwd`, so the password stayed in that request's details. Console and diagnostic text now also hides `pwd=`, `passphrase:` and these sessions. Parameters whose names only contain `key`, `auth` or `sid`, such as `keyword` or `author`, stay readable; like `password`, `pwd` and `passphrase` count anywhere in a name.
- Passwords sent in a few more form fields are now redacted in network request details and network search, WebSocket and EventSource messages, the request's copies as cURL, PowerShell or fetch, HAR exports, agents' `browser_network_request` and the links in page snapshots: Drupal's `pass`, `pass[pass1]`, `pass[pass2]` and `current_pass`, WordPress's `pass1` and `pass2` when a password is set or reset, Roundcube's `_pass`, Simple Machines Forum's `passwrd`, and the `pw` field many other sites use, in form and JSON bodies such as Drupal's own REST sign-in. No pattern matched them, so the password stayed readable. Console and diagnostic text also hides `passwrd=`. Names that only contain `pass` or `pw`, such as `passenger`, `compass`, `pwa` or `pass_rate`, stay readable, and so does a JSON `true`, `false` or `null` under `pass` or `pw`, as in a test report; a name that ends in `_pass`, such as `boarding_pass`, is redacted too.
- Workspace names now stay on one line without hidden characters when a workspace is created, renamed or imported from a template: line breaks and tabs become spaces, and invisible formatting characters such as a right-to-left override, a zero-width space or tag characters are removed. An agent could name its workspace with them, so the name added a paragraph to a dialog that named it, read backwards, or hid text in it. The joiners and direction marks that emoji and some scripts need stay, and a name saved before is kept until the workspace is renamed.
- An EVM RPC node's error message no longer passes a key from an address on to the page or agent that sent the request. Hronaut removes addresses from the node's message, but it first turned characters such as `?`, `=`, `&` and `@` into spaces, which split an address there, so `https://upstream.example/v1?apikey=SECRET` reached the page as `apikey SECRET`, and an address with a user name and password kept its host, path and query.
- A tab whose agents you paused now stays paused when it comes back: with **Reopen Closed Tab** (**Ctrl/Cmd+Shift+T**) or **Recently closed**, with **Undo** after closing it, and when its workspace is restored from the archive, with **Undo** after closing or archiving it; a duplicate of it is paused too. Agents could act in it again, although a restart kept it paused. A tab whose input you locked now stays locked in the same cases.
- An agent opening its archived workspace with `browser_saved_workspaces` no longer shows it in the window. It ended your split view and moved keyboard focus into the agent's page, in another workspace, so what you typed next went to that page. The window now stays as it is, as with an agent's other calls; **Follow agents** still shows where it works.
- A download still running when control of its workspace changed, such as when you paused agents, no longer comes back under an agent's control when you archive and restore the workspace. `browser_downloads` listed it again, and the agent could pause, resume or cancel it.

## [3.3.1] - 2026-10-19

### Security

- A website can no longer capture your screen behind a prompt about your camera and microphone. A page that asked for the screen through `getUserMedia` with `chromeMediaSource: "desktop"` showed "requests “Camera and microphone” permission", and Allow gave it a live video of your whole screen, other apps included. Hronaut now refuses every request to capture the screen, a window or a tab at once, without a prompt, and the website gets a permission error. `getDisplayMedia` requests used to show the same prompt and then fail even when allowed.

### Fixed

- When a website asks for only your microphone or only your camera, Hronaut's prompt now names just that device, such as "Microphone", in Hronaut's language. It used to say "Camera and microphone" for every such request; the line below it already listed the requested devices.

### Known issues

- A panel opened in its own window keeps the operating system's tooltips instead of the themed ones.
- While a notification such as **Tab closed** shows at the bottom of the page, the page does not get clicks or wheel scrolling in the area just around the notification, about 10 px on each side.
- `wallet_sendCalls` batches are not atomic: when a later call is rejected, fails or reverts, the earlier calls stay on chain, as separate transactions would. A dApp that requires an atomic batch gets error code 5760. A batch whose transaction the network dropped while its nonce is still unused stays pending, and `wallet_showCallsStatus` is not supported.
- An EVM node that lags behind for more than a minute, or has pruned old transactions, can make a mined transaction look replaced, so Hronaut reports it as failed.
- A link or form on a dApp that starts a download, or that the server answers with no content, counts as leaving the page for wallet requests: Hronaut cancels the page's open wallet requests and returns it to its default network without a `chainChanged` event, although the page stays.
- `wallet_balance` marks an allowance `unlimited` only at 2^160 − 1 or more, so a token that stores allowances in 96 bits, such as UNI, shows its maximum approval as a large amount.
- Typed-data meta-transactions are recognized by type name, by a `bytes` call-data field named `data`, `callData`, `calldata` or `functionSignature`, or as a MetaMask delegation. One that uses another name and another field name is still signed on mainnet when **Also sign typed data on mainnet** is on, so that switch is not a general spending limit.
- Wallet policies saved by 2.45.0 or earlier that list a token method (`erc20.`, `trc20.` or `nft.`) do not sign token calls without a click. Remove such a policy and add it again with its token contract, or with **Allow any token contract**.
- Websites' raw `eth_sign`, Solana and TRON requests still need a person to approve, even under a website sign-in policy, and typed data is signed without a click only by a dedicated agent wallet with the typed-data switch on.
- Hronaut does not inject `window.tronLink` or `window.tronWeb` as a full TronWeb instance; Tron dApps that require TronLink specifically will not detect it.

## [3.3.0] - 2026-10-19

### Added

- Agents can check what Chromium itself computes for one element's accessibility, where page heuristics guess wrong: a number input is a spinbutton and a multiple select a listbox. `browser_computed_accessibility` returns the element's computed role, whether and why it is hidden from assistive technology (such as `aria-hidden`, `inert` or not rendered), and states such as expanded, selected, pressed, checked, required and readonly, with states Chromium did not report listed apart from false. The element's name, description and value never leave Hronaut, and elements with too much text to check first are refused.
- Agents can see what a value was when the page's code reached a line, without editing or rebuilding the app. `browser_logpoint` lists a page's scripts and the sources their source maps name, then records an expression at up to five source or script lines each time the page runs them, up to 50 times each for at most five minutes. Each hit pauses the page for about 2 ms while Chromium evaluates the expression under its side-effect check, so an expression that would change the page is refused instead of run; values are bounded and stay in memory, and reading them needs the same page-interaction permission as setting them. A logpoint stops at its hit limit before the page resumes, counting hits in other frames too, only fires in the exact build it was set in, survives a reload of that build, and ends when the page leaves its origin, you click or type in the page, agents are paused, Developer Tools open or you select **Logpoints** in the address bar.
- Agents can inspect apps that keep their state in a Web Worker. `browser_workers` lists the dedicated workers a page's own document started from its own scripts, each with a short-lived handle, and evaluates JavaScript in exactly the worker a handle names, never in the page or another worker. Results are bounded, a script still running at its deadline is stopped, and loading another page, a reload, a pause or the worker ending retires the handle instead of reaching another worker. Workers are never paused, and Hronaut's debugger leaves them again after each call.
- Agents can test an app's passkey registration and sign-in on localhost without your fingerprint reader, security key or a system dialog. `browser_virtual_passkey` attaches a software authenticator to one tab for one exact localhost origin, so the app's own `navigator.credentials` calls create real credentials and real signatures its server can verify; `configure` can make user verification fail, and `status` counts what the authenticator did. It works only with a capability profile whose `browser_virtual_passkey.origin` constraint lists the exact origins; full-access credentials are refused. It starts only when every frame of the page is at that origin, and ends as soon as any frame starts loading another origin, when it expires (10 minutes by default, 30 at most), when agents are paused, the agent loses control or you click or type in the page, when Developer Tools open, and when you select **Virtual passkey** in the address bar. Other tabs and popups keep your real authenticators, credentials stay in memory only, and results never include credential IDs, keys or user names. A sign-in must name the credential, as after a username step: username-less sign-in does not work in Hronaut's browser.
- Agents can find the code behind a DOM change, such as what disabled a button, emptied a list or closed a dialog. `browser_dom_mutation_source` arms a one-time capture on one element for an attribute change, a change below it or its removal, and returns the stack of the first matching change: function names, script addresses as origin and path, and positions, never values or page content. The page resumes at once, the breakpoint is removed after the first match, Hronaut's own snapshots and element lookups don't count as the change, and a navigation, a replaced element, a change of agent control, a renderer crash or opening Developer Tools invalidates it.
- Agents can test date-dependent screens at a chosen moment, such as "today" in a date picker, a greeting or an expiry banner around a calendar boundary. `browser_fixed_date` stages an instant for one tab and its current origin; from the next page load within that origin, whoever starts it, the page's `Date.now()`, `new Date()` and `Date()` return it from the page's first script, while timers, animations, frames, workers and other tabs keep real time and time zone emulation still applies. Staging never reloads the page. The fixed clock does not move, so timeouts measured with Date can stall until it is reset. Loading another origin, a person clicking or typing in the page or a change of agent control disarms it instead of carrying it on, and reset leaves the open page's fixed Date until it reloads; `status` says which.
- Agents can keep a page in its loading state for as long as they need to check it, then finish it with a known response. `browser_network_routes` with `holdUntilReleased: true` on a mock captures the page's next matching GET `fetch` or XMLHttpRequest to its own origin and holds it, so spinners, skeletons and disabled buttons stay on screen while the agent takes snapshots and screenshots; `action: "release"` then answers it with the mock response exactly once, and `action: "cancel"` fails it. A hold lasts at most `holdSeconds` (default 30, up to 120), a tab holds at most four requests, and `action: "held"` lists them without their URLs, headers or bodies. A hold that ends any other way (timeout, clearing request conditions, navigation, closing the tab or Hronaut, opening Developer Tools) fails the request instead of sending it to the real server.

### Fixed

- The window that shows a new wallet's recovery phrase is now in Hronaut's language, including its warning never to share the phrase and its **I saved it** and **Not yet** buttons. So are the window for choosing a video's audio (its title, button and file type) and the title of a tab's Developer Tools window. They used to stay in English in every language.
- A new tab now shows its name in Hronaut's language, such as "Нова вкладка" or "Neuer Tab". This applies in the tab strip, Search tabs, the command palette, split view, the tab menu, the Undo notice after closing the tab, and Home, including while the tab's first page loads. It used to read "New tab" in English in every language. Agents still see the title "New tab", and Search tabs and the command palette find a new tab by the name you see.
- A tab whose site could not be reached is now named in Hronaut's language, such as "Сайт недоступний" or "Website nicht erreichbar", instead of "Site unavailable" in every language. Agents see the same title, in the same language as the page problem they already receive.
- When a website asks for a permission, Hronaut's prompt now names it the way **Settings → Site permissions** does, such as "Location" or "Clipboard read", in Hronaut's language. It used to show Chromium's identifier, such as "geolocation" or "clipboard-read". Requests to lock the mouse pointer or the keyboard, control MIDI devices, keep the screen on or keep site data in persistent storage now have names too, in the prompt and in Settings. A file access request also says "read access" or "write access" in Hronaut's language instead of "readable" or "writable", and its sentence now reads naturally in German, French, Spanish, Polish and Russian.
- The status notice at the top of **Settings → Wallets** now shows an info icon, or a warning icon when wallets are off, like the notices in other settings sections. It used to show the letter "H".
- Hronaut in Ukrainian, Russian, German, French, Spanish or Polish no longer shows the Wallets settings, the video recorder, capability profiles, the remote connections setting and Home's MCP readiness checks in English. About 400 strings in each language had never been translated; they now are, and a test fails when a language shows English labels or sentences again. In those languages, **Settings → MCP security** also no longer says that only processes on this computer can connect while authentication is off: like the English text, it now warns that other computers can too when remote access is on.
- An agent's call on a tab no longer stays shown as running after Hronaut withholds its result because the agent's access changed while it ran, such as a capability profile expiring during a `browser_pwa_lifecycle` read. The activity now ends as failed.
- Recording code coverage no longer freezes a page that contains a `debugger` statement. The page used to stop at the statement until coverage was stopped, so the report missed everything after it; it now keeps running. Opening Developer Tools still ends the recording, and they pause on the statement as usual.

### Known issues

- A panel opened in its own window keeps the operating system's tooltips instead of the themed ones.
- While a notification such as **Tab closed** shows at the bottom of the page, the page does not get clicks or wheel scrolling in the area just around the notification, about 10 px on each side.
- `wallet_sendCalls` batches are not atomic: when a later call is rejected, fails or reverts, the earlier calls stay on chain, as separate transactions would. A dApp that requires an atomic batch gets error code 5760. A batch whose transaction the network dropped while its nonce is still unused stays pending, and `wallet_showCallsStatus` is not supported.
- An EVM node that lags behind for more than a minute, or has pruned old transactions, can make a mined transaction look replaced, so Hronaut reports it as failed.
- A link or form on a dApp that starts a download, or that the server answers with no content, counts as leaving the page for wallet requests: Hronaut cancels the page's open wallet requests and returns it to its default network without a `chainChanged` event, although the page stays.
- `wallet_balance` marks an allowance `unlimited` only at 2^160 − 1 or more, so a token that stores allowances in 96 bits, such as UNI, shows its maximum approval as a large amount.
- Typed-data meta-transactions are recognized by type name, by a `bytes` call-data field named `data`, `callData`, `calldata` or `functionSignature`, or as a MetaMask delegation. One that uses another name and another field name is still signed on mainnet when **Also sign typed data on mainnet** is on, so that switch is not a general spending limit.
- Wallet policies saved by 2.45.0 or earlier that list a token method (`erc20.`, `trc20.` or `nft.`) do not sign token calls without a click. Remove such a policy and add it again with its token contract, or with **Allow any token contract**.
- Websites' raw `eth_sign`, Solana and TRON requests still need a person to approve, even under a website sign-in policy, and typed data is signed without a click only by a dedicated agent wallet with the typed-data switch on.
- Hronaut does not inject `window.tronLink` or `window.tronWeb` as a full TronWeb instance; Tron dApps that require TronLink specifically will not detect it.

## [3.2.0] - 2026-10-19

### Added

- Agents can copy a finished download into a folder you allow, under a new name, for documents that need a task-specific filename and location. `browser_download_copy` takes a completed download's id from `browser_downloads`, a folder and a portable file name, copies the file byte for byte up to 2 GiB, and returns the copy's path and size. It works only with a capability profile whose `browser_download_copy.directory` constraint lists the exact folders, created in Settings → MCP security; full-access credentials are refused. It never replaces an existing file, refuses a download whose file changed since it finished, creates the copy readable only by your account where the system supports that, and removes only its own partial file if the copy fails, reporting an unknown outcome when it cannot confirm the partial file is gone.
- Agents can fill a plain text field or text area with the exact text of a local file, so long or exact values such as fixtures, generated identifiers or multi-line JSON reach the field without being retyped in the call. `browser_fill_from_file` takes an absolute path to a UTF-8 file of up to 64 KiB, the origin the text is meant for and optionally the file's SHA-256, refuses before writing anything when the page is elsewhere or still loading, the file is unusable, or the text would not fit unchanged (line breaks in a single-line field, carriage returns, past `maxlength`), and reports whether the field holds exactly the text after the page's handlers ran and again a quarter second later, without repeating the text, the field's value or the path. It needs the external-request capability, like file uploads.
- Agents can insert text at the caret of a focused editor, or in place of its selection, without replacing the rest of its content: for continuing a draft, replacing a selected word, rich-text editors, and emoji or non-Latin text in one call. `browser_insert_text` takes a `ref` or `selector` for a text input, textarea or editable region that already has focus and up to 4,096 characters, and sends them through Chromium's native text input, so the page gets trusted `beforeinput`, `textInput` and `input` events as from an input method. Text that a field's `maxlength` would cut short is refused before anything is sent. While the text is sent, a guard cancels its insertion into any other element of the top-level page if focus moves there at that moment; it cannot reach frames, so focus that left for one makes the result unconfirmed. The result says whether the editor took the text (and whether Chromium or the editor itself inserted it), refused it, was blocked or is unconfirmed, including an editor that reported an edit but reset its content, and never repeats the text.
- You can keep URL query strings and fragments out of what agents read, for sites that put session or callback values in their addresses. **Hide URL details from agents** in **Settings → MCP security** (off by default) shows agents tab addresses as origin and path only, without credentials, in workspace state, saved workspaces, tab search, page problems, dialogs, hand-back notes, the URL line of page snapshots, quality checks, URL waits, visual comparisons and WebMCP calls, and a tab title that shows the address is shortened the same way. Results say `urlDetail: "omitted"`. Browsing itself still uses the real address. Paths, page text, screenshots and other tools can still show private details.
- Agents can see the flex container around an element when a card refuses to shrink or a toolbar overflows. `browser_element_inspect` with `includeFlexContainer: true` returns the element's sizing inputs and its immediate parent's flex direction, wrap, row and column gaps, text direction, writing mode and content size, or a reason when the parent is not an ordinary flex container (including shadow hosts, custom elements and native containers such as buttons) or the element is not rendered or out of flow. Siblings, other ancestors, text and attributes are not read, and the report does not say which constraint decided the size.
- Agents can skip receiving a screenshot that shows nothing new, which saves the image tokens of checking a canvas, map or chart again after an action. `browser_screenshot` with `trackChanges: true` also returns an `observationId`; a later viewport capture with `ifChangedSince` set to it returns `UNCHANGED` and no image when the returned image's pixels are identical, or `CHANGED` with the new image and a new id. Captures are compared only at the same page, page scroll position, viewport, zoom, forced CSS state and capture options, and otherwise start over with a fresh image (scrolling inside an element or a changed emulation is compared by its pixels), and a page that changed during the capture or did not answer in time gets its image with `NOT_TRACKED`. JPEG compression and downscaling can hide a small change. Each connection keeps at most 16 fingerprints in memory for 10 minutes after their last use, never the images, and only for results that were delivered. Unchanged pixels do not prove that the page or its state is unchanged.
- Agents can read what a web component renders inside its shadow root, which page snapshots do not show: the buttons, headings and text of components such as those built with Lit. `browser_snapshot` with `shadowHostSelector` captures the open shadow root of one element of the page, with nested open components and slotted content once each, as read-only text listing the same kinds of headings and controls a snapshot lists, without refs, and the rendered text. Content the page does not render, such as a closed `details`, is left out. Form field values and editor content are never read, frames and closed shadow roots are not entered, and nothing in the page is changed. A capture stopped by its node, depth, time or size limit says it is incomplete.
- Agents can drop local files onto a page's drop zone, for importers and attachment areas that have no file input, or to test drop handling itself. `browser_file_drop` takes a `ref` or a `selector` that matches one element and 1 to 20 absolute paths to readable files, and gives the page Chromium's own trusted `dragenter` and `dragover` events carrying the files, as a drag from the file manager would, and the `drop` only when the page accepts them. Before any drag event reaches the page it refuses a target that is missing, matches more than one element, is hidden, covered or a frame, or was replaced, a page shown at a zoom scale other than 1, and paths that are not readable files. The result says whether the page received the drop (`DROPPED`), did not accept it (`NOT_ACCEPTED`, after the drag leaves the page without dropping) or could not be observed (`DROP_UNCONFIRMED`), with the number of files but never their paths or contents. A page may upload files as soon as they are dropped, and a drop does not prove that it read them. It is in the QA and complete tool sets.

### Changed

- Home lists connected agents in a **Connected agents** panel beside the workspace cards instead of a cloud of chips over the greeting. Each client gets one row, the agents that need you first: its avatar with its state as a dot, its name with any bridge it came through shown apart ("Claude", "via mcp-remote 0.1.37"), what it is doing and the workspaces it is doing it in, each one a click away. Several sessions of one client, such as three Claude Code windows, share a row with a **3 sessions** toggle that tells them apart by state, workspace, when each connected and, when they differ, client version; it opens by itself once more than one of them is busy and stays open until you close it. The greeting now stays on one line, the agent status beside it is a single pill with the server's details in a popover that closes on Escape, a click elsewhere or moving focus past it, the workspace search shows its label as a placeholder, and the "Hronaut Home" label above the greeting is gone: Home's title in the window's top bar now carries the Hronaut icon instead.

### Fixed

- Saving a PDF of a tab whose page had crashed closed all of Hronaut. A PDF export or screenshot of a crashed page now fails at once with a message to reload or close the tab, and a screenshot no longer returns an image that is not the page. Both work again once the page loads.
- An agent that connects through a bridge such as mcp-remote is named as the product everywhere Hronaut names agents, as Home's list of connected agents already did: its avatar, card and cursor, the live status strip, the take-over prompt, the Following label, its steps, and Home's live activity and workspace cards now say "Claude (via mcp-remote 0.1.37)" instead of "claude-ai (via mcp-remote 0.1.37)". The one-line agent status in the toolbar and on Home leaves the bridge out, so it reads "Claude is working".

### Known issues

- A panel opened in its own window keeps the operating system's tooltips instead of the themed ones.
- While a notification such as **Tab closed** shows at the bottom of the page, the page does not get clicks or wheel scrolling in the area just around the notification, about 10 px on each side.
- `wallet_sendCalls` batches are not atomic: when a later call is rejected, fails or reverts, the earlier calls stay on chain, as separate transactions would. A dApp that requires an atomic batch gets error code 5760. A batch whose transaction the network dropped while its nonce is still unused stays pending, and `wallet_showCallsStatus` is not supported.
- An EVM node that lags behind for more than a minute, or has pruned old transactions, can make a mined transaction look replaced, so Hronaut reports it as failed.
- A link or form on a dApp that starts a download, or that the server answers with no content, counts as leaving the page for wallet requests: Hronaut cancels the page's open wallet requests and returns it to its default network without a `chainChanged` event, although the page stays.
- `wallet_balance` marks an allowance `unlimited` only at 2^160 − 1 or more, so a token that stores allowances in 96 bits, such as UNI, shows its maximum approval as a large amount.
- Typed-data meta-transactions are recognized by type name, by a `bytes` call-data field named `data`, `callData`, `calldata` or `functionSignature`, or as a MetaMask delegation. One that uses another name and another field name is still signed on mainnet when **Also sign typed data on mainnet** is on, so that switch is not a general spending limit.
- Wallet policies saved by 2.45.0 or earlier that list a token method (`erc20.`, `trc20.` or `nft.`) do not sign token calls without a click. Remove such a policy and add it again with its token contract, or with **Allow any token contract**.
- Websites' raw `eth_sign`, Solana and TRON requests still need a person to approve, even under a website sign-in policy, and typed data is signed without a click only by a dedicated agent wallet with the typed-data switch on.
- Hronaut does not inject `window.tronLink` or `window.tronWeb` as a full TronWeb instance; Tron dApps that require TronLink specifically will not detect it.

## [3.1.0] - 2026-10-18

### Added

- Agents can save a screenshot of the visible page as a PNG in the downloads folder without the image coming back in the response, to keep a local QA record their model does not have to look at. `browser_screenshot_save` takes an optional file name and `maxWidth`/`maxHeight`, never overwrites an existing file, and returns only the file's name, path, MIME type, pixel size, byte count and capture time, plus the forced CSS state note when one is applied. Captures with more pixels than an 8K frame, emulated viewports included, and PNGs over 64 MiB are refused. A navigation, a closed tab or a cancelled call before the file is complete fails the save, and Hronaut tries to remove its partial file. When the agents are paused or the workspace's access is withdrawn after the file was written, the agent is told a file was saved but not its name or location. The PNG holds whatever the page shows and stays on your computer. Verified on Linux; macOS and Windows are untested.
- Agents can tap and swipe with one finger on a page with touch emulation turned on, so a mobile carousel, swipe-to-dismiss card or touch-only canvas can be tested through its touch handlers instead of mouse events. `browser_touch` takes `gesture: "tap"` at viewport `x`/`y`, or `gesture: "swipe"` in a straight line to `endX`/`endY` over `durationMs` (50 to 2000 ms, 300 by default). The page gets trusted touch events and touch pointer events, and a tap also its click. The agent turns touch on first with `browser_emulate`; Hronaut never turns it on by itself. The gesture stops when the agents are paused, the page is locked, navigates (within the document too) or changes, or the call is cancelled, and a finger that went down is then lifted with a touch cancel, so the next gesture starts clean. Desktop Chromium touch emulation is not Safari, iOS or real-device testing. Verified on Linux; macOS and Windows are untested.
- Agents can Shift-drag, Alt-drag or Control-drag (Command-drag on macOS), for example to constrain movement or snap differently in a canvas editor. `browser_drag` takes `modifiers` (`Shift`, `Alt`, or `ControlOrMeta`, which is Meta on macOS and Control elsewhere) for element and coordinate drags. The page sees the keys on every mouse event of the drag, from the press through the release; no key events are sent, so no key can stay pressed. Verified on Linux; macOS and Windows are untested.
- Agents can Shift-click, Control-click or Meta-click a control, for example to extend or add to a selection in a list, grid or file manager. `browser_click` takes `modifiers` (`Shift`, `Control`, `Meta`, or `ControlOrMeta`, which is Meta on macOS and Control elsewhere) together with `native: true` and one ref or selector. The page sees the keys only on that click's own mouse events; no key events are sent, so no key can stay pressed. A `ControlOrMeta` click on a link opens it in a background tab of the same workspace. On macOS `Control` is rejected, since a Control click there opens a context menu. Verified on Linux; macOS and Windows are untested.
- The Network panel can copy a request as a PowerShell command. **Copy sanitized PowerShell** sits next to cURL and fetch and writes one `Invoke-WebRequest` command for Windows PowerShell 5.1 or PowerShell 7 and later, with the same secret filtering and body omissions as the other copies. Quotes, `$`, backticks and brackets in the request stay literal, and the body is sent as UTF-8. A request PowerShell cannot send faithfully, such as one with a repeated header or an uncommon method, gets an explicit error instead of a changed command. Agents can ask for the same text with `copyAs: "powershell"` on `browser_network_request`.
- Agents can save a page as PDF with bookmarks for its headings by passing `outline: true` to `browser_pdf_save`, so a long document exported from a wiki or docs site can be navigated from the PDF viewer's outline. The option is experimental and off by default. It makes a tagged PDF, which also carries the page's structure and image alt text and is larger. Bookmarks cover the headings Chromium prints, nested by level; a page without headings gets none. The result still returns only the file name, path and size.
- Agents can save a page as PDF at the paper size its CSS asks for by passing `preferCSSPageSize: true` to `browser_pdf_save`, to check a print stylesheet at its own size. A CSS `@page` size wins over `pageSize` and `landscape`, which still apply when the page sets none. The option is off by default, and a PDF that would have more than 1,000 pages at the CSS size is refused instead of saved.

### Changed

- The address field now fills the toolbar between the navigation buttons and the commands instead of stopping at 520 px in the middle of a wide window. The take-over prompt still fits beside it by taking room only while the field stays at least 520 px wide, and address suggestions open at the field's full width.
- Hronaut now runs on Electron 44.9 (Chromium 152.0.7977.167), which brings that release's security and stability fixes.
- Packaged Hronaut can no longer be started as a plain Node process, ignores `NODE_OPTIONS` and Node inspector switches, and loads its code only from its own `app.asar`, which macOS and Windows now check against the hash recorded at build time. This closes ways another program could run code with Hronaut's identity and permissions; nothing changes for people using the app.
- The tab rail is calmer. The agent status at its bottom stays on one line ("2 agents working" no longer wraps), with **Pause agents** as its icon when the rail is under 340 px wide. **Stay here** under a followed workspace is a quiet text action instead of a pill that filled the row. Rows no longer repeat the lock and muted speaker on every tab while the browser-wide lock or mute is on; the pressed buttons say it once, a tab that plays sound keeps its speaker, and each tab's tooltip still says it is locked or muted.

### Fixed

- A script that never finishes no longer blocks the agent's workspace or your window. Before, when `browser_evaluate` ran a script whose promise never settled, such as one waiting on a request that never answers, the call waited forever: every later action in that workspace was refused as busy until the tab was closed, even after the agent gave up on the call, and when Hronaut was in the background its window could not be focused again. Now `browser_evaluate` waits up to `timeoutMs`, 30 seconds by default and at most 300 seconds, and stops waiting at once when the agent cancels the call. The agent is told the script may still be running in the page, with its effects unknown, and the workspace and window are free again. A script that needs more time can pass a larger `timeoutMs`.
- An agent's action no longer hangs when the page's renderer crashes or is stopped. Before, the call waited forever, and because it kept its workspace busy, every later action in that workspace was refused as busy until the tab was closed; reading a crashed page, such as with `browser_snapshot`, also waited forever. Now an action in flight fails as soon as the renderer exits, with its effects reported as unknown, and actions on the crashed page fail at once with a message to reload or close the tab. You can still lock or unlock the crashed tab, and reloading it makes it work again. A key hold or a native click's press that the crash interrupted still asks the agent to close the tab before the next one, as after any unconfirmed release.
- An agent's hover or drag on a tab whose input you locked now reaches the page. Before, Hronaut's lock kept out every pointer move the agent made: `browser_hover` reported success but the page saw no movement, so no hover menu or tooltip opened, and a drag delivered only its press and release, so a page that follows the pointer while the button is held, such as a canvas editor or a sortable list, saw no drag, although `browser_drag` reported success. Your own pointer input stays locked out.
- When Hronaut refuses a wallet transaction without asking anyone, for example a send from a watch-only account, the page or agent now gets the reason, such as `Wallet policy rejected the request: wallet-capability-disabled`, instead of "Wallet request was rejected by the user". No person saw those requests. Pages still get error code 4001.

### Known issues

- A panel opened in its own window keeps the operating system's tooltips instead of the themed ones.
- While a notification such as **Tab closed** shows at the bottom of the page, the page does not get clicks or wheel scrolling in the area just around the notification, about 10 px on each side.
- `wallet_sendCalls` batches are not atomic: when a later call is rejected, fails or reverts, the earlier calls stay on chain, as separate transactions would. A dApp that requires an atomic batch gets error code 5760. A batch whose transaction the network dropped while its nonce is still unused stays pending, and `wallet_showCallsStatus` is not supported.
- An EVM node that lags behind for more than a minute, or has pruned old transactions, can make a mined transaction look replaced, so Hronaut reports it as failed.
- A link or form on a dApp that starts a download, or that the server answers with no content, counts as leaving the page for wallet requests: Hronaut cancels the page's open wallet requests and returns it to its default network without a `chainChanged` event, although the page stays.
- `wallet_balance` marks an allowance `unlimited` only at 2^160 − 1 or more, so a token that stores allowances in 96 bits, such as UNI, shows its maximum approval as a large amount.
- Typed-data meta-transactions are recognized by type name, by a `bytes` call-data field named `data`, `callData`, `calldata` or `functionSignature`, or as a MetaMask delegation. One that uses another name and another field name is still signed on mainnet when **Also sign typed data on mainnet** is on, so that switch is not a general spending limit.
- Wallet policies saved by 2.45.0 or earlier that list a token method (`erc20.`, `trc20.` or `nft.`) do not sign token calls without a click. Remove such a policy and add it again with its token contract, or with **Allow any token contract**.
- Websites' raw `eth_sign`, Solana and TRON requests still need a person to approve, even under a website sign-in policy, and typed data is signed without a click only by a dedicated agent wallet with the typed-data switch on.
- Hronaut does not inject `window.tronLink` or `window.tronWeb` as a full TronWeb instance; Tron dApps that require TronLink specifically will not detect it.

## [3.0.0] - 2026-10-17

### Changed

- Every theme now sits on the redesigned shell through its colors, corners and edges. Cyberpunk Turbo's hard 4 px corners reach Home and every newer panel instead of a fixed list of controls (pills and round marks stay round, and the page keeps its rounded corners); Cyberpunk's and Turbo's glowing edges reach every dialog and panel instead of four dialogs; and Matrix's background no longer scrolls while nothing happens. Each theme's text, warning, error and success colors now stay readable on every surface: Light and Sepia get darker error and success colors and a gold warning that no longer looks like the amber of a request waiting for you, Sepia's secondary text is slightly darker, Cyberpunk Turbo's error color is lighter, and the dark themes get a brighter warning orange. Sepia no longer borrows the dark themes' pale amber and pink for the paused and error agent status, and error messages in Downloads, Bookmarks, History, site storage and Settings use the theme's error color.
- When another app already uses Hronaut's MCP port, Hronaut now says so in plain words ("Another app is using port 47812, so agents can't connect.") instead of showing `EADDRINUSE`, and offers **Use port 47813**, a free port it found, on Home, in the agent status popover, in Settings and in the startup dialog. One click moves the listener there and saves it; then give your coding agent the new address, which Home shows. A port taken in the meantime is said so everywhere with the next free port offered, a port the system refuses is explained the same way, and when no nearby port is free Hronaut offers one the system picks.
- Home can add Hronaut to Claude Code for you. When Claude Code is on this computer and MCP authentication is off, its setup instructions, and the first-run panel, offer **Set up Claude Code**: Home shows the exact entry it would add to `~/.claude.json` (or replace, if Claude Code points to Hronaut at another address), and nothing changes until you confirm in Hronaut's own dialog. Hronaut saves a byte-for-byte backup beside the file first and keeps every other setting. It asks you to review again if the file changed meanwhile, and points you to the command if the file cannot be rewritten exactly. Agents found on this computer now lead the list of setup instructions, marked **On this computer**. Hronaut only checks that their usual folders or settings files exist; it never runs them.
- Home shows **Live activity** beside your workspaces: what each agent just did, in plain words, with the workspace and when, marked **Local only**. Repeated steps show once with a count, a request still waiting for you says so in amber, and choosing a step opens its workspace. Overview now lists recent actions in plain words too and keeps its setup checks and client list folded away; each check says Ready, Needs attention or Not yet. The MCP endpoint and **Copy URL** moved under **Details** beside the agent status.
- Home opens as mission control for your agents: a greeting with "2 agents connected. 1 workspace needs you.", a chip for each connected agent and **Connect an agent**, and a live card per workspace with its tabs and icons, what its agent is doing or last did, and an amber ring when an agent needs you. The whole card opens the workspace and its **⋯** menu holds the rest. Archiving or clearing a workspace from Home now offers **Undo** instead of asking first, as it does elsewhere in Hronaut.
- Home now updates as soon as an agent connects, acts or asks for you, instead of on its next refresh, and no longer receives MCP session ids. It also keeps the last 50 steps agents finished, in memory only, for its live activity.
- The command palette (Ctrl/Cmd+Shift+P) now also finds your open tabs, workspaces, Settings sections and recently visited pages as you type, in one list under their own headings, so you can jump to a tab, a workspace or a setting without opening another panel. Commands stay first unless something else matches clearly better by name, and a Settings section never outranks a command of the same name, so "downloads" still shows your downloads; with nothing typed the palette lists commands as before.
- Home now uses the same colors, type, corners and shadows as the rest of Hronaut and follows its theme, instead of a palette of its own. Home and the agent status button in the top strip say the same thing in plain words: **Ready for agents**, **Claude Code connected**, **Claude Code is working**, **Needs you**, **Agents paused**, **Getting ready for agents** or **Agents can’t connect**, instead of "MCP server online", "MCP ready" or "MCP error". The server's own state, request counts and any startup error are under **Details** on Home and in the button's popover and tooltip. Agents are named as people know them, such as Claude Code for `claude-code`, here, on their avatars and on their cursor. An agent that quit without saying goodbye stops counting after 5 minutes, as its avatar does.
- Search tabs shows real thumbnails for more of your tabs. A tab keeps the picture it had when it goes to sleep, dimmed under a **Sleeping** badge, instead of "Sleeping — open to preview"; the tab in view is pictured again about a second after you click, type or scroll; and a screenshot of a background tab, by an agent or by you, updates its card. Hronaut still never wakes a tab to picture it, and a tab with no picture yet now says **No preview yet** with its site icon and address. Pin and **Full-page preview** moved from every card into a **⋯** menu beside **×**.
- Settings is rebuilt on the redesign's controls. Each group of settings now sits in a rounded card with a hairline between rows, like the theme picker, and on/off settings that save as soon as you change them use a switch instead of a small checkbox (a few, like the system title bar, still say when they need a restart); screen readers still announce them as checkboxes. The settings column is limited to a comfortable reading width on wide windows. Forms that apply with a Save button, such as the workspace editor, keep checkboxes.
- The workspace editor matches the new Settings cards. Allow direct agent access, Hide from left sidebar and Protect from deletion share one rounded card with a hairline between them instead of three separate boxes, and the Website access, Continuity & human decisions, and Copy or move website data sections are cards with a chevron that turns as they open instead of a plus and minus sign. Its workspace pickers and allowed-sites field use the shared controls and share one look with the name and description fields, and in high-contrast mode a focused field keeps a visible outline. The Keyboard shortcuts dialog now writes keys the way your platform does, as the command palette does: ⌘, ⌥, ⌃ and ⇧ on macOS, Ctrl, Alt and Shift elsewhere. It also lists only your platform's keys for picking an element, history and developer tools: ⌘⌥C, ⌘Y and ⌘⌥I on macOS, Ctrl+Shift+C, Ctrl+H and F12 elsewhere.
- The top of the open tab rail is regrouped. The pin that keeps the rail open is now an icon beside Home instead of a row of its own, with the same tooltip and one click. Below it, a small **Workspaces** heading above the groups carries two icon buttons: Switch workspace, which opens the new workspace switcher, and Create workspace, which moved there from the end of the list. Search tabs stays at the bottom of the rail and on Ctrl+Shift+A (Cmd+Shift+A on macOS). A folded rail still shows Home, the pin under it and Create workspace at the end, and its workspaces and tabs keep their rows when it opens. If a dialog opened from the rail, such as the workspace switcher, closes after the rail has folded behind it, focus now returns to Home, which opens the rail again, instead of being lost. The tab strip above the page is unchanged.
- Each workspace in the tab rail and tab strip is now a card in a soft tint of its color with a 1 px border in that color, and the workspace showing the page in view is tinted a little more, so you can tell at a glance where you are. A round color dot after the folding arrow replaces the thin color bar, and the workspace's header shares its card's color instead of a separate darker band. Dark themes use a stronger tint than light ones; a workspace that needs you keeps its amber border.
- The website now sits in the window as a card with 12 px rounded corners, a hairline edge and a soft shadow, instead of running edge to edge against the toolbar and the tab rail. With the tab rail, the rail, the toolbar and the space around the page share one surface without dividing lines, and on Windows and Linux the minimize, maximize and close buttons sit on that same color. A 10 px margin separates the page from the window's right and bottom edges, from a docked or side panel and, with tabs above the page, from the left edge, so at the same window size the page's viewport is about 10 px shorter and 10 to 20 px narrower. In a short window, a panel docked above or below the page keeps the height it had, so Page tools still shows a whole result, and the margins come out of the page. Each page of a split view is its own card. Home, emulated viewports and the picture of the page under a dialog have the same corners.
- With the tab rail, Hronaut's frame around the page now takes a soft wash of the color of the workspace you are looking at, strongest in the top-left corner behind the rail and fading out before the middle of the window, so you can tell out of the corner of your eye which client or project a page belongs to. Switching to a page in another workspace crossfades the color over 600 ms. Home, Settings and pages outside a workspace keep the plain surface, and so do the tab strip above the page and panels in their own windows. The page itself and the window controls keep their colors, and text keeps its contrast.
- On macOS and on Windows 11 (22H2 and later), the open tab rail is now translucent in the Light and Dark themes: the desktop shows softly through it, with macOS's sidebar vibrancy and Windows' Mica, while the toolbar, the space around the page and the workspace cards keep their solid colors. Linux, older Windows, Windows with the system title bar, the other themes, tabs above the page and the system's Reduce transparency, Increase contrast, transparency effects off or high-contrast settings keep the solid rail. The Find, Zoom and page problem bars now start beside the tab rail instead of under it, so a page problem's message is no longer partly hidden behind the rail.
- The website toolbar is regrouped. The four tab toggles, input lock, agent pause, freeze and mute, now sit together in one capsule instead of four separate boxes. A pressed toggle keeps its fill and a ring in its own color under the pointer, so it never looks merely hovered. The address field is centered between the navigation buttons and the commands and grows to at most 520 px, so on a wide window it no longer stretches across the whole toolbar; status badges such as emulation or request routes lift that limit so they never squeeze out the address, and address suggestions stay under the field when it moves. In a narrower window, such as 1024 px with the tab rail open, the address field fills the first row and every command moves together to a tidy second row that ends where the address ends, instead of a few commands staying beside the address and the rest wrapping loosely below. The last command also keeps a 20 px space before the window controls on Windows and Linux. Every command, tooltip and shortcut is unchanged.
- The toolbar now shows the coding agents working in the workspace you are looking at, as round avatars after the address field. Each shows the first letter of the MCP client's own name, in a color that stays the same for that client. Up to three are shown, then +N with the other names. An idle agent is pale, a working agent has a breathing ring (steady with reduced motion), and an agent that needs you comes first with an amber ring and badge and its reason in the tooltip. Hover shows what the agent is doing in plain words, such as "Opening a page" or "Reading the page"; click opens its card (see below). An agent appears after its first call in that workspace, whatever the tool, and leaves 5 minutes after its last call or when its MCP session closes; one that is waiting for you stays until you answer. Only the client's name (cleaned up, at most 64 characters), the kind of step and, for some steps, what it acts on (see below) reach the toolbar, never typed text, field values, queries or the session ID.
- Clicking an agent's avatar in the toolbar, or pressing Ctrl+. (Cmd+. on macOS), opens a card for that agent under its avatar, above the page. It shows the client's name, "Connected over MCP" with the workspace, whether it is working, idle or needs you and why, what it is doing now, and its last three finished steps, with failed ones in red. From the card you can turn Follow on or off for all workspaces, show or hide agent cursors on the page, pause or resume agents on the tab it used, take over (which pauses agents on that tab and shows it), and show that tab when it is not the one in view. Pause and take over are unavailable while agent control is locked. Esc or the close button closes the card and returns focus to the avatar; clicking anywhere else, switching workspace or leaving the window closes it too, and Follow waits while it is open. The shortcut opens the card of the agent that needs you, or else the first one; a website keeps Ctrl+. for itself, such as for an editor's quick fix, while its workspace has no agents. The agent whose card is open keeps its avatar in view until the card closes, even when other agents would push it into +N; one that disconnects meanwhile stays, marked as disconnected. The card is drawn by Hronaut in its own layer and only ever receives the text it shows.
- An agent's steps now say what they act on, in the avatar's tooltip and in its card: "Clicking “Review order”", "Typed in Promo code", "Opened shop.example/checkout in a new tab", instead of only "Clicking on the page", "Typed" or "Opened a page". Hronaut takes the name when its own page snapshot shows that control to the agent: a button or link by its label, a button input by its caption, and a form field only by its label, placeholder or title, never by what is typed in it or its value; a field without one keeps the general phrase. Addresses show only the site and path, without sign-in details, query or fragment, and only for web pages; search terms keep the general phrase. Steps that act on a CSS selector or coordinates, run scripts or read the page keep the general phrase too, as does any step after the page loads another document. These names reach only Hronaut's own toolbar and card, never agents, saved data or diagnostics.
- When an agent asks for you, the **Needs you** mark on its avatar, workspace and tab now stays until the request is answered or ends, instead of disappearing at your next click or key press anywhere in Hronaut, even in another workspace (a known issue in 2.50.0). A click or key press still tells agents you have seen it, as before: the tray pulse, taskbar flash and notification stop, and `browser_status` and `browser_preflight` no longer report the request. The agent's card now answers it under **Why it needs you**: **Done, hand back** tells the agent that asked that you finished, the same as **Mark as resolved** in the tab menu, and **Dismiss** clears it without saying the task is done. For a decision the agent left for you, the card offers **Review the decision**, which opens the workspace with its activity and decisions shown, and the mark stays until the decision is answered or closed. The mark also ends when, after you saw it, the agent that asked goes on to act in that workspace, such as clicking, typing or opening a page, so it does not linger after the agent continued without waiting; acting on another tab than the one it asked about does not count. A request with no agent avatar to answer it from, such as one made without a workspace, or after the MCP server stopped or agent access to the workspace was turned off, still ends at your click as before. As before, it ends when the request expires, a newer request replaces it, its tab or workspace closes, or you choose **Dismiss** in the tray menu.
- A page that needs you now has an amber ring around it while the request is open: the handoff edge light. When an agent asks for you on a tab, that tab's page gets the ring whenever it is in view; a request for a whole workspace rings each of its pages in view, as the rail marks that workspace. The ring swells once over 2.4 seconds when it appears (it just appears with reduced motion), then holds until the request is answered or ends, so a glance at the window says which page is waiting for you. Hronaut draws it in the space around the page, never on the website, and sets it aside while a dialog or menu covers the page. High-contrast modes show a system-colored outline instead.
- An agent's cursor on the page now carries its name. When an agent clicks, hovers or drags, an arrow in the agent's avatar color glides to the spot with a tag showing the agent's name, such as "Claude Code", so you can tell which agent is acting and where. It glides from where it is in 600 to 900 ms, depending on the distance, instead of appearing in place. Since the page gets the click at once, a small ripple marks the spot as it happens, while the cursor is still on its way; a drag gets the ripple where it grabs, and the cursor stays pressed from the drag's start to its end. The cursor stays for 2 seconds after it arrives and then fades. With reduced motion it jumps and the ripple only fades, and high-contrast modes draw it in system colors. The cursor never takes clicks and is hidden from screen readers, and the website cannot read its name, though a website could still hide or move it, since it is drawn on the page. Hronaut takes it off the page before an agent's screenshot or visual comparison and before saving a page as PDF, so it is not in those captures; video recordings show it. To turn agent cursors off, use **Show agent cursors** in Appearance settings or the new switch in an agent's card.
- When you answer an agent's decision in **Edit workspace → Human decisions**, you can now write to the agent: a note with **Complete review**, **Approve**, **Reject** or **Cancel decision**, or the answer itself when the agent asked for input. The agent gets it with the decision through `browser_human_waiting` `list`, along with when you answered. Hronaut keeps notes in memory only and never saves them, so after a restart a decision shows its state without the note.
- You can now answer most of an agent's decisions right in its card, without opening the workspace. When the agent asks you to look at a page, the card says so in your language and offers **Looks good, hand back**, or **Something wrong?** to send it back with a note on what to fix. When it asks for input, type your answer in the card and press **Send** or Ctrl+Enter (Cmd+Enter on macOS). When it wants approval for an action, the card shows what it would do, up to four steps with whether each can be undone and on which site, and lets you reject it with a reason; approving still happens in the workspace with **Review and approve**, where the exact action is shown. Before you hand back or send an answer, Hronaut checks the page and lists what it found, such as an earlier action whose outcome is unknown, and asks you to tick that you looked at the page as it is now, the same confirmation as in the workspace. If the page changes after you tick, or more than 30 seconds pass before you send, nothing is sent and the card shows the page as it is now for you to confirm again. The card always has a way into the workspace (**Open in workspace**, **Review and approve** or **Review the decision**), and a page Hronaut cannot check from the card, such as one still loading, is answered in the workspace. What you typed stays in the card if sending fails, and is gone when the card closes; an answer already on its way still reaches the agent if you close the card.
- **Follow agent activity** now says whom it follows and stays put long enough to read. It shows the page where an agent is working in any workspace, as before, and with the tab rail the workspace it brought into view now shows **Following** and the agent's name, such as "Following Claude Code", under its header, with **Stay here** to turn Follow off and keep the page in view. When several agents work at once, Follow stays with the agent it showed until 4 seconds after that agent's last step, instead of jumping to whichever agent acted last; an agent's long step, such as waiting for a page, does not keep the others out. When you press a key, click, scroll or touch a page, Follow waits 3 seconds and then moves only with the agents' next steps, so the page does not change under you while you read or type; an agent's own scrolling does not count. The mark goes away when you pick a tab yourself, even the same one again, until an agent's next step, and when the agent disconnects. The tab strip above the page and a folded rail do not show it; the Follow button in the toolbar still shows whether Follow is on.
- You can now keep an agent's live status in view in a strip below the toolbar. Turn on **Pin live status below the toolbar** in Appearance settings, or with the new switch in an agent's card, and every page in a workspace shows the agent working there, what it is doing now, such as "Clicking “Review order”", and **Pause** and **Take over** for its tab. When the agent needs you, the strip turns amber with its reason and a **Hand back** button, or, for a decision, says it is waiting for your decision and offers **Answer**, which opens its card. With several agents the strip shows the one that needs you first, then +N. The strip keeps its place even when no agent is working, so the page does not jump as agents come and go, and the page moves down to make room for it. The chevron at its end unpins it. It is off by default.
- A new **full-page view** gives the website the whole window. Press Ctrl+Shift+F (Cmd+Shift+F on macOS), or choose **Full-Page View** in the View menu or **Toggle full-page view** in the command palette, and the tabs, the tab rail, the toolbar and the pinned live strip step aside; the page grows to fill the window below a slim band that shows its title and leaves room for the window controls. Rest the pointer on that band, or with the tab rail on the window's left edge, and they come back while you use them; move back onto the page, or click it, and they step aside again. They also come back whenever an agent needs you, with its amber avatar, until you answer, and they stay while something you opened from them is open, such as an agent's card, downloads or the site controls, and while Find, Zoom or another bar sits under the toolbar. Keyboard focus still reaches them: Ctrl+L, for example, shows the toolbar and puts you in the address field. Home and Settings show everything as usual. The revealed toolbar has an **Exit full-page view** button; the same keys, pressed in Hronaut or in the website, turn the view off too. While the view is on, the tabs and toolbar don't move the window. The view lasts until you turn it off or close Hronaut. A website no longer receives Ctrl+Shift+F (Cmd+Shift+F) itself, as with Hronaut's other browser shortcuts.
- When an agent is working on a page and you click or type in it, the toolbar now offers **Take over from Claude Code?**, with the agent's name, never over the page. It takes only room the toolbar has to spare, at the start of the commands, so the address field never narrows and the toolbar keeps its height: with less room it shows only its buttons, and with none the agent's avatar gets a small hand badge instead. **Take over**, or Ctrl+Shift+O (Cmd+Shift+O on macOS) whenever an agent is working on the page in view, pauses that agent on the tab (pressed in a page, the tab you pressed it in) and tells it you have control; its next step there fails with that message instead of a general pause. The toolbar then shows **You have control** with **Hand back to Claude Code** (or just **Hand back**, or the badge, as room allows), which resumes the agent and leaves it a short note of what changed: how long you had the tab, whether the page moved to another address or reloaded, and whether you clicked or typed, never what you typed or read. Addresses in the note leave out sign-in details, secret-looking query values and the part after #. Agents read the note in `browser_tabs` as the tab's `handedBack`. The offer lasts 8 seconds after your last click or key press, and only while the agent is still working on that tab; scrolling does not offer it, and × keeps that agent's offers away while it goes on working on the tab. **Take over** in the agent's card and the live strip now works the same way, and any resume of a tab you took over hands it back with the note, as does telling the agent you are done with what it asked (**Done, hand back**, **Hand back** in the strip, or **Mark as resolved**). A website keeps Ctrl+Shift+O for itself while no agent is working on it, and an agent's own Ctrl+Shift+O always reaches the page. In the full-page view the band at the top shows the offer; rest the pointer on it for the button.
- A new workspace switcher gets you to any workspace from the keyboard. Press Ctrl+K (Cmd+K on macOS), choose the search icon in the tab rail's **Workspaces** heading, or run **Switch workspace** from Commands. Workspaces where an agent needs you come first, then those where an agent is working, then the rest by recent use, yours or an agent's, with archived workspaces at the bottom. Each row shows the tab count, up to two of its sites, and whether an agent needs you there or which agents are working. Type to find a workspace by its name, description, an agent's name or a site, then press Enter to go there: an archived workspace is restored, and a workspace without tabs gets a new one. With nothing typed, Enter goes to where an agent needs you or is working, or else to the workspace used most recently. **Search tabs** and **New workspace** sit at its bottom. A website keeps Ctrl/Cmd+K for itself, so its own search shortcut still works there.
- With the tab rail on the left, a long list of workspaces now ends after the first 10 in an **All N workspaces** row that opens the workspace switcher, instead of a rail you scroll through. The workspace you are working in and one where an agent needs you stay in the rail, in their usual place, whatever their position. The row also appears with an amber dot when a workspace you hid from the left sidebar needs you. Workspaces only fold away when there are more than 11, and the tab strip above the page still lists them all.
- An agent's card now has **All steps** under its recent steps. It opens that agent's last 20 steps in the workspace, newest first, grouped by the tab they acted on, each with the time and whether it failed, and **Show tab** takes you to a tab that is still open. A step on the tab you are looking at comes with a small picture of the page as it was right after the step, so you can see what the agent did without replaying it. Hronaut takes a picture only of a tab already on screen, once its page has settled, and keeps it in memory only: it is never saved, and agents never receive it. When an agent works in a tab you are not looking at, a step fails, or several steps follow each other quickly, those steps show without a picture. Closing a workspace drops its steps and pictures. The list follows new steps while it is open, keeps the last steps of an agent that disconnects, and closes with Esc.
- With the tab rail, each workspace's header now shows the coding agents seen there as small overlapping avatars after its name, in the same colors as the toolbar's: a ring while one works, amber while it needs you, dimmed while it is idle, and a +N count past three. Their names and states are in the header's tooltip. A folded workspace now opens by itself when a new agent starts working there or it starts waiting for you. Fold it again and it stays folded while the same agents carry on, even through their pauses; restarting Hronaut opens no folded workspace by itself.
- You can now pin workspaces to the top of the tab rail. Right-click a workspace's header and choose **Pin Workspace to Top**; it moves above the others with a small pin after its name, and workspaces you pin later go after it. **Unpin Workspace** in the same menu puts it back in its place. Pinned workspaces never fold away into the **All N workspaces** row, and the workspace switcher lists them, marked Pinned, after those where an agent needs you or is working and before the rest. Pins are saved with your workspaces; archiving a workspace unpins it. Agents see when a workspace was pinned as `pinnedAt` in `browser_workspaces`, but only you can pin or unpin one.
- When you answer an agent's request for you, the agent's card now shows your answer in its recent steps, with a person icon and when you gave it, such as "You handed it back · 02:15", "You sent it back to fix" or "You approved the action", in place of the request it answered. All steps lists it too. The agent's avatar stays for five minutes after you answer, even when it had waited longer than that, so the card does not turn to "Disconnected" as you answer. Answers are kept in memory only, like the agent's steps.
- New keys to move between workspaces. **Alt+1** to **Alt+9** (**Control+1** to **Control+9** on macOS) go to your first nine pinned workspaces, from the top, and a pinned workspace's tooltip shows its key. **Alt+0** (**Control+0** on macOS) goes back to the workspace you viewed before; press it again quickly to step further back. A key an agent sends stays with the page, so an agent cannot switch your workspace. They work from a website too, unless there is no workspace for the key, and they are listed in Keyboard shortcuts. On macOS, Control with a digit no longer selects a tab or resets zoom; Cmd with a digit still does. On Windows and Linux, Alt alone now shows the menu when you release it rather than when you press it, as other apps do, so Alt with a digit or a click shows no menu; AltGr, which types characters on many keyboard layouts, never shows it.
- Closing tabs, closing a workspace from its editor, archiving a workspace from its header and removing a bookmark now show a toast with **Undo** for 6 seconds instead of asking first. Undo reopens closed tabs in their places, brings a workspace back with its tabs, and puts a bookmark back in its collections; Ctrl+Z (Cmd+Z on macOS) outside a text field does the same. The toast stays while the pointer or keyboard focus is on it, for up to a minute. A closed workspace's sign-ins and site data are deleted only once Undo is gone, and agents cannot reopen or copy it meanwhile. With 50 archived workspaces, closing one still asks first and deletes it at once. Agents' actions never offer Undo.
- The command palette (Ctrl+Shift+P, Cmd+Shift+P on macOS) is redesigned. It is frosted over a blurred page and lists commands under headings: **Recent**, with the last five commands you ran, then **Navigation**, **Current website**, **Application** and **Agents**. When an agent works in the workspace you are looking at, **Agents** comes right after Recent, with **Show agent details**, and **Take over from the agent** while it is working on the page in view. Each command now has its own icon and shows its keys the way your platform writes them, such as ⌘⇧A on macOS and Ctrl Shift A elsewhere. Recent commands are kept on this computer, in your profile only. The workspace switcher and an agent's All steps share the new frosted frame, and the switcher shows Ctrl+K or ⌘K the way your platform writes it.

### Fixed

- When a coding agent quit without closing its MCP session, the toolbar and Home kept showing it as connected until something else changed. It now drops out once its 5 minutes without requests are up.
- When a long agent name is cut short in the toolbar's status button, its tooltip now shows the whole status, such as "Claude Code connected", before the MCP address, instead of only the address.
- Notifications such as **Tab closed** with its **Undo** button now appear at the bottom of the page, centered over it, instead of across the top of the window, so they no longer cover tabs, toolbar buttons or the address field while they are showing. The same goes for Home, Settings and full-page view. While one is up you can keep typing in the address field, and after you click the notification, keyboard focus goes back to the page or field you were using.
- Resizing Hronaut's window no longer makes the tab strip or the toolbar jump for a moment. The room kept for the window's own buttons, such as minimize, maximize and close, now stays the same while the window gets wider or narrower. Before, it briefly grew by the change in width, which could push the toolbar's commands onto a second row for a few frames.
- In Polish, Russian and Ukrainian, counts in Hronaut's window now use the right word form, such as "1 вкладка", "2 вкладки", "5 вкладок" and "21 вкладка", instead of "1 вкладки" and "2 вкладок". Panels, Settings, the workspace switcher, Commands and other dialogs were affected; Home already counted correctly.
- When an agent removed a page's viewport with `browser_resize` and `reset: true` right after setting a smaller one, it could get the old emulated size back, such as 600 × 360, on a busy computer. It now gets the size the page takes in its view, waiting up to a second for the page to catch up.

### Known issues

- A panel opened in its own window keeps the operating system's tooltips instead of the themed ones.
- While a notification such as **Tab closed** shows at the bottom of the page, the page does not get clicks or wheel scrolling in the area just around the notification, about 10 px on each side.
- `wallet_sendCalls` batches are not atomic: when a later call is rejected, fails or reverts, the earlier calls stay on chain, as separate transactions would. A dApp that requires an atomic batch gets error code 5760. A batch whose transaction the network dropped while its nonce is still unused stays pending, and `wallet_showCallsStatus` is not supported.
- An EVM node that lags behind for more than a minute, or has pruned old transactions, can make a mined transaction look replaced, so Hronaut reports it as failed.
- A link or form on a dApp that starts a download, or that the server answers with no content, counts as leaving the page for wallet requests: Hronaut cancels the page's open wallet requests and returns it to its default network without a `chainChanged` event, although the page stays.
- `wallet_balance` marks an allowance `unlimited` only at 2^160 − 1 or more, so a token that stores allowances in 96 bits, such as UNI, shows its maximum approval as a large amount.
- Typed-data meta-transactions are recognized by type name, by a `bytes` call-data field named `data`, `callData`, `calldata` or `functionSignature`, or as a MetaMask delegation. One that uses another name and another field name is still signed on mainnet when **Also sign typed data on mainnet** is on, so that switch is not a general spending limit.
- Wallet policies saved by 2.45.0 or earlier that list a token method (`erc20.`, `trc20.` or `nft.`) do not sign token calls without a click. Remove such a policy and add it again with its token contract, or with **Allow any token contract**.
- Websites' raw `eth_sign`, Solana and TRON requests still need a person to approve, even under a website sign-in policy, and typed data is signed without a click only by a dedicated agent wallet with the typed-data switch on.
- Hronaut does not inject `window.tronLink` or `window.tronWeb` as a full TronWeb instance; Tron dApps that require TronLink specifically will not detect it.
- jsdom is held at 30.1.1 because 30.1.2 breaks focus in 6 Home page tests. This affects the test environment only.

## [2.50.0] - 2026-10-16

### Added

- A tab emulating a viewport smaller than the window now shows that viewport at its exact size, centered on a dotted backdrop with a thin frame, instead of the page sitting in the corner of an empty background. A caption above the page names the size, Desktop or Mobile, and the pixel ratio when it is not 1×, with buttons to rotate the viewport, fit it to the window and return the tab to the window size. When the window is only a little taller than the viewport, the page moves down just enough for the caption; without room above, the caption goes below the page, or into a card beside it when only the sides have room. In split view each pane frames its own tab. The page still gets the emulated viewport, and an agent's screenshots keep the emulated size. Removing the viewport, from the frame, Responsive preview or an agent, gives the page the whole space at once.
- When an agent asks for you, its workspace in the tab rail or tab strip now says so: the workspace's header shows **Needs you** in amber, and the whole group gets an amber border and glow. Before, only a requested tab was marked, so a request that named no tab showed nothing in the rail, and a folded workspace or one you were not looking at gave no sign. The header's tooltip and screen reader description give the agent's reason, and its name ends with "Needs you". As with the tab's mark, it clears when you click or press a key in Hronaut, or when the request's tab or workspace closes. In the top tab strip and in a folded rail, where a header has little room, an amber dot takes the label's place.

### Changed

- Hronaut's toolbar, tab rail, panels and dialogs now show their tooltips in the current theme, with the app's font, instead of the operating system's plain tooltip. A tooltip appears half a second after the pointer rests on a control, below it, or beside it in a vertical tab rail, and always above the website, since Hronaut draws it in its own layer over the page. Moving straight to the next control shows its tooltip at once, and clicking a control or pressing a key hides it. The text is unchanged, including shortcuts, though a very long one, such as a long workspace description, shows its first 12 lines. Screen readers still get it as the control's description, or as its name for icon buttons that had no other name. A panel in its own window keeps the system tooltips.
- Hronaut's interface now uses one type scale, one set of corners and three shadow levels across the shell, dialogs, panels, Settings and the address suggestions, and bundles the Geist Sans and Geist Mono fonts instead of relying on whichever system font was installed. Home uses Geist too. Text uses six sizes and three weights instead of thirteen sizes and ten weights, corners from 6 px up use four radii instead of fifteen, and floating surfaces use three neutral shadows. Some text moves by one step on the new scale, for example 18 to 24 px headings now share 20 px and the address bar text is 13 px, and lines are slightly taller in Geist. Theme colors are unchanged. This is the foundation of the redesign that follows; the fonts are licensed under the SIL Open Font License and listed in the third-party notices.
- Dialogs, menus, popovers and notifications now open and close with a short motion instead of appearing and vanishing at once. A dialog such as Commands, Search tabs or Settings grows in from slightly smaller over the dimmed page and fades out when it closes; menus and popovers grow from their button, and notifications slide in. With the system's reduce motion setting on, dialogs, menus and popovers only fade, and notifications appear without motion. The page stays dimmed under a closing dialog until it has faded out, and a tab picked in Search tabs takes keyboard focus as soon as the dialog is gone.
- Checkboxes, radio buttons and dropdowns across Hronaut, such as in Create workspace, the Page tools dock picker, the Tabs result filter, Settings and Wallets, now use the theme's colors and corners instead of the operating system's blue controls. A checked box or chosen option fills with the theme's accent, and dropdowns show a small chevron. They work the same with the keyboard and screen readers, and high-contrast modes keep the system's own controls.

### Fixed

- Opening Commands, Search tabs, a workspace editor, Settings or another Hronaut dialog no longer flashes the page area white. Before, Hronaut hid the website the moment a dialog opened, and the empty window showed for several frames until the dialog was drawn. Now a still picture of the page stays under the dialog, and the page is hidden only once that picture is on screen. The page also stays visible behind an open dialog, dimmed and softly blurred, instead of leaving an empty area. This also holds when a dialog opens just as Hronaut updates the page's preview for the tab overview, such as right after the page loads or the window is resized.
- On Windows and Linux, the minimize, maximize and close buttons in the top-right corner now dim with the rest of the window when Search tabs, Create workspace, Commands or another dialog with a backdrop opens, and return to their colors when it closes. Before, they stayed at full brightness above the backdrop, because they are drawn above the window's own content. A dialog opened over another dims them by both backdrops.

### Known issues

- An agent's request for you, and the **Needs you** mark on its workspace and tab, end at your next click or key press anywhere in Hronaut, even in another workspace or on a control unrelated to the request.
- A panel opened in its own window keeps the operating system's tooltips instead of the themed ones.
- `wallet_sendCalls` batches are not atomic: when a later call is rejected, fails or reverts, the earlier calls stay on chain, as separate transactions would. A dApp that requires an atomic batch gets error code 5760. A batch whose transaction the network dropped while its nonce is still unused stays pending, and `wallet_showCallsStatus` is not supported.
- An EVM node that lags behind for more than a minute, or has pruned old transactions, can make a mined transaction look replaced, so Hronaut reports it as failed.
- A link or form on a dApp that starts a download, or that the server answers with no content, counts as leaving the page for wallet requests: Hronaut cancels the page's open wallet requests and returns it to its default network without a `chainChanged` event, although the page stays.
- `wallet_balance` marks an allowance `unlimited` only at 2^160 − 1 or more, so a token that stores allowances in 96 bits, such as UNI, shows its maximum approval as a large amount.
- Typed-data meta-transactions are recognized by type name, by a `bytes` call-data field named `data`, `callData`, `calldata` or `functionSignature`, or as a MetaMask delegation. One that uses another name and another field name is still signed on mainnet when **Also sign typed data on mainnet** is on, so that switch is not a general spending limit.
- Wallet policies saved by 2.45.0 or earlier that list a token method (`erc20.`, `trc20.` or `nft.`) do not sign token calls without a click. Remove such a policy and add it again with its token contract, or with **Allow any token contract**.
- Websites' raw `eth_sign`, Solana and TRON requests still need a person to approve, even under a website sign-in policy, and typed data is signed without a click only by a dedicated agent wallet with the typed-data switch on.
- Hronaut does not inject `window.tronLink` or `window.tronWeb` as a full TronWeb instance; Tron dApps that require TronLink specifically will not detect it.
- jsdom is held at 30.1.1 because 30.1.2 breaks focus in 6 Home page tests. This affects the test environment only.

## [2.49.0] - 2026-10-16

### Added

- dApps can now run more of viem's read actions through Hronaut's wallet provider: `createAccessList`, `getProof`, `getBlobBaseFee`, `getBlockTransactionCount`, `getTransaction` by block and index, and `simulateBlocks` or `simulateCalls`, which some dApps use to preview a swap's balance changes. Their methods (`eth_createAccessList`, `eth_getProof`, `eth_blobBaseFee`, the block transaction count and by-index methods, and `eth_simulateV1`) are forwarded to the active wallet network's RPC like the other reads, without an account permission or a prompt. Before, they failed with code 4200 in Hronaut, although MetaMask forwards them.
- dApps that sign EIP-712 typed data with the older `eth_signTypedData_v3` method now work in Hronaut. The request gets the same approval dialog, warnings and wallet policy checks as `eth_signTypedData_v4`, and is signed the way MetaMask signs it. Hronaut accepts it only when v3 and v4 produce the same signature: no array types, a declared `EIP712Domain` type and a value for every declared field. Other v3 requests fail with code 4200 and a message that names `eth_signTypedData_v4`, instead of a signature the dApp's contract would reject.
- dApps can now check who signed a message with `personal_ecRecover`, as MetaMask's test dapp does to verify a `personal_sign` signature. Hronaut returns the signing address in the same checksummed form as `eth_accounts`, without a connection or a prompt, since it uses no wallet key and reads no network. Before, the method failed with code 4200 in Hronaut. A signature that is not 65 bytes or cannot be recovered fails with code -32602.
- The local wallet QA fixture's **Sign in with Ethereum** button now checks the signature it gets back with `personal_ecRecover`, as a website's sign-in backend would, and logs `sign-in:verified` with `signerMatches`, so an agent can see that the connected account really signed the sign-in text. The log never shows the address, the text or the signature.
- An agent testing a dApp that batches calls with `wallet_sendCalls` can now see where each batch got to. `wallet_page_requests` lists the site's newest 20 batches as `callBatches`, with the network, how many calls each holds, whether Hronaut is still sending it, stopped before the last call or sent every call, each sent call's transaction hash and status, and the error that stopped it when Hronaut could not send its next call, such as one the account could not pay for. Before, the agent had to pick the batch's transactions out of the page's requests and could not tell a batch that stopped early from one still waiting for a call to be mined. A batch ID that is not a plain ID reads `not shown`, since the page chooses it.
- The local wallet QA fixture has a **Send 1 wei twice in one batch** button that sends two transfers as one EIP-5792 `wallet_sendCalls` batch, as wagmi's `useSendCalls` does, then reads `wallet_getCallsStatus` until the batch is done. It logs only the status code, receipt count and receipt outcomes, never the batch ID, account, recipient or hashes. The wallet QA quickstart shows how to check that Hronaut asks for each call in order and how an agent follows the batch under `callBatches`, including a batch stopped by a rejected call.

### Fixed

- When the network answers that it already has a transaction the person approved, for example after a hosted RPC retried the send itself, the dApp now gets the transaction hash and Hronaut waits for its receipt, as in MetaMask. Before, the request failed although the transaction could be mined, so a dApp could retry or show an error for a payment that went through. Hronaut first checks that the node still holds the transaction, since some nodes also say so for one they dropped. Two identical requests approved at the same nonce sign the same transaction, which the network runs once, so only the first counts as sent and the other fails with "Transaction was already sent by another wallet request".
- An EVM transaction that another transaction replaced, for example after a wallet elsewhere sped it up or cancelled it with the same key, now ends as failed instead of staying submitted forever. Hronaut counts it as replaced when the node no longer holds it and the account has already mined a transaction with its nonce, on at least three checks over a minute. A `wallet_sendCalls` batch stops at such a call instead of waiting 10 minutes, and `wallet_getCallsStatus` reports 400 (not included) when none of its calls reached the chain, or 600 when some did. Before, the batch stayed at 100 (pending). A dropped transaction whose nonce is still unused stays pending, since another node may still mine it.
- A dApp that changes its own route while a wallet request is open, such as a client-side router adding `?from=ETH` to the address while the approval dialog shows, no longer loses that request. Before, any route change in the same page, through `history.pushState`, `replaceState` or a fragment, cancelled the page's pending wallet approvals, so the dApp got "Wallet request was cancelled", and reset the network it had switched to with `wallet_switchEthereumChain` back to the default without a `chainChanged` event. Now only navigating to another document does that. An agent's `wallet_page_requests` also keeps listing the page's requests across such route changes.
- A dApp tab waiting on a wallet approval no longer goes to sleep under it. Before, Memory Saver or **Sleep eligible tabs now** could unload an inactive tab while its page waited on a connection, signature or transaction request, or while its `wallet_sendCalls` batch waited to send the next call; the request stayed open, so a person could still approve and send it although the page that should get the result was gone. Such a tab now stays awake from the moment its page asks, while Hronaut is still preparing the request, until the request is answered or the batch is done, like a tab with an open dialog. An agent's open wallet request for the tab keeps it awake the same way until it is answered or expires.

### Known issues

- `wallet_sendCalls` batches are not atomic: when a later call is rejected, fails or reverts, the earlier calls stay on chain, as separate transactions would. A dApp that requires an atomic batch gets error code 5760. A batch whose transaction the network dropped while its nonce is still unused stays pending, and `wallet_showCallsStatus` is not supported.
- An EVM node that lags behind for more than a minute, or has pruned old transactions, can make a mined transaction look replaced, so Hronaut reports it as failed.
- A link or form on a dApp that starts a download, or that the server answers with no content, counts as leaving the page for wallet requests: Hronaut cancels the page's open wallet requests and returns it to its default network without a `chainChanged` event, although the page stays.
- `wallet_balance` marks an allowance `unlimited` only at 2^160 − 1 or more, so a token that stores allowances in 96 bits, such as UNI, shows its maximum approval as a large amount.
- Typed-data meta-transactions are recognized by type name, by a `bytes` call-data field named `data`, `callData`, `calldata` or `functionSignature`, or as a MetaMask delegation. One that uses another name and another field name is still signed on mainnet when **Also sign typed data on mainnet** is on, so that switch is not a general spending limit.
- Wallet policies saved by 2.45.0 or earlier that list a token method (`erc20.`, `trc20.` or `nft.`) do not sign token calls without a click. Remove such a policy and add it again with its token contract, or with **Allow any token contract**.
- Websites' raw `eth_sign`, Solana and TRON requests still need a person to approve, even under a website sign-in policy, and typed data is signed without a click only by a dedicated agent wallet with the typed-data switch on.
- Hronaut does not inject `window.tronLink` or `window.tronWeb` as a full TronWeb instance; Tron dApps that require TronLink specifically will not detect it.
- jsdom is held at 30.1.1 because 30.1.2 breaks focus in 6 Home page tests. This affects the test environment only.

## [2.48.0] - 2026-10-15

### Added

- An agent testing a dApp can now see the wallet calls the page made that failed. `wallet_page_requests` lists the newest 20 as `failedCalls`, with the method and the error the page received, such as a method Hronaut does not support (`eth_signTypedData` gets code 4200), a network it cannot switch to, or a refused token offer. Before, a dApp button that silently caught such an error left the agent with nothing to go on. Reads forwarded to the node, such as `eth_call`, are left out, the page's parameters are never listed, and the wallet's address stays hidden until the agent has account permission.
- dApps that batch calls with EIP-5792, such as wagmi's `useSendCalls` approving a token and then swapping it, now work in Hronaut. `wallet_sendCalls` runs the calls one at a time, in order, each as an ordinary transaction with its own approval dialog or wallet policy check, waits for each call to be mined before preparing the next, and stops at the first call that is rejected, fails, or reverts. `wallet_getCallsStatus` reports the batch's status and receipts to the site that sent it, and `wallet_getCapabilities` tells the dApp that calls are not atomic, so a dApp that requires an atomic batch gets the standard error code 5760 instead.
- "Add token to wallet" buttons in dApps and faucets now work in Hronaut. `wallet_watchAsset` (EIP-747) accepts a valid ERC-20, ERC-721 or ERC-1155 suggestion without a prompt, since Hronaut keeps no token list and accepting moves no funds. Like MetaMask, it refuses with code -32602 an ERC-20 offer whose symbol or decimals disagree with the token contract, so a button with wrong details fails in Hronaut as it would for real users. An agent testing the page sees every offer in `wallet_page_requests` under `suggestedAssets`, with the contract's own symbol and decimals and why an offer was refused.
- `wallet_balance` takes an optional `spender` with `token` on EVM and TRON wallets and also returns that spender's remaining allowance, formatted and raw, marked `unlimited` for an unlimited approval, so an agent testing a dApp can check that its approve step asked for the expected amount or that a revoke cleared it. It uses the same account permission as the token balance.
- The local wallet QA fixture has an **Add token to wallet** button that offers its test token with `wallet_watchAsset`, with editable symbol and decimals, logging only whether the offer was accepted or its error code. The wallet QA quickstart shows how to install a stand-in token on Anvil so a wrong decimals value is refused, and how an agent reads the offers under `suggestedAssets`.
- When a transaction's simulation reverts on an EVM network, the approval dialog now says why under **Revert reason**: the contract's message, such as "Too little received", a Solidity panic such as an arithmetic overflow, a named or unnamed custom error such as `ERC20InsufficientAllowance`, or that it reverted without a reason. Before, it only said the simulation failed, and a transaction without a gas limit whose gas estimate reverted, such as a swap whose price moved, failed before any dialog opened. Like other wallets, Hronaut now prepares such a transaction with a fallback gas limit (95% of the latest block's, at most 16,777,216) so the dialog can show why. An agent testing a dApp sees the same reason as `simulationRevert` in `wallet_page_requests`, and `wallet_prepare_transaction` returns it for the agent's own transactions. Hronaut reads it from the revert data, never from the RPC's error text, and the request still needs a person.

### Fixed

- When the network refuses a transaction a person approved, the dApp and an agent now learn why: for example "the node refused the transaction: nonce too low, the account already used this nonce", or that the account cannot pay for gas and value, the replacement or gas price is too low, the max fee is below the block base fee, the gas limit is out of range, the node already has the transaction, or the transaction is for another chain. Before, they only got "Wallet request failed validation or processing". Hronaut matches the wordings of common EVM nodes and reports them in its own words with the node's JSON-RPC server error code, never the node's text, which can name the RPC endpoint.
- Hronaut no longer follows CCIP-Read (EIP-3668) offchain lookups in its own wallet reads and simulations. Before, a contract could answer the token checks behind a page's `wallet_watchAsset`, an agent's `wallet_balance`, or a transaction simulation with an `OffchainLookup` revert naming any URL, including addresses on the local network, and Hronaut's main process fetched it without asking anyone. Those reads now fail like any other revert. A dApp's own `eth_call` through the provider still returns the revert data, so the page can do the lookup itself in the browser.
- An agent that asks for wallet account access again while the person is approving its first request, such as one polling `wallet_balance`, no longer opens a second **Connect account** prompt. The repeat reuses the request being approved.
- Contract event listeners in dApps built on ethers v6, such as `contract.on('Transfer', …)`, now fire in Hronaut. ethers listens through node filters, which the wallet provider rejected, so the listener retried forever without delivering events. The provider now forwards `eth_newFilter`, `eth_newBlockFilter`, `eth_getFilterChanges`, `eth_getFilterLogs` and `eth_uninstallFilter` to the active wallet network's RPC. A filter belongs to the tab and site that created it and survives the dApp's route changes, so one site cannot read or remove another's filter by guessing its ID. A tab keeps at most 32 filters per site; past that, ethers and viem fall back to polling logs.

### Known issues

- `wallet_sendCalls` batches are not atomic: when a later call is rejected, fails or reverts, the earlier calls stay on chain, as separate transactions would. A dApp that requires an atomic batch gets error code 5760. A batch whose transaction the network drops stays pending, and `wallet_showCallsStatus` is not supported.
- `wallet_balance` marks an allowance `unlimited` only at 2^160 − 1 or more, so a token that stores allowances in 96 bits, such as UNI, shows its maximum approval as a large amount.
- When the node answers that it already has a transaction the person approved, Hronaut still reports the request as failed, although that transaction may be mined.
- Typed-data meta-transactions are recognized by type name, by a `bytes` call-data field named `data`, `callData`, `calldata` or `functionSignature`, or as a MetaMask delegation. One that uses another name and another field name is still signed on mainnet when **Also sign typed data on mainnet** is on, so that switch is not a general spending limit.
- Wallet policies saved by 2.45.0 or earlier that list a token method (`erc20.`, `trc20.` or `nft.`) do not sign token calls without a click. Remove such a policy and add it again with its token contract, or with **Allow any token contract**.
- Websites' raw `eth_sign`, Solana and TRON requests still need a person to approve, even under a website sign-in policy, and typed data is signed without a click only by a dedicated agent wallet with the typed-data switch on.
- Hronaut does not inject `window.tronLink` or `window.tronWeb` as a full TronWeb instance; Tron dApps that require TronLink specifically will not detect it.
- jsdom is held at 30.1.1 because 30.1.2 breaks focus in 6 Home page tests. This affects the test environment only.

## [2.47.0] - 2026-10-15

### Added

- Wallet approvals for EIP-712 typed data warn when the request looks like a meta-transaction or a delegation: a recognized ERC-2771, GSN, Gelato, Biconomy, 0x, ERC-4337 or Safe 4337 request, a MetaMask delegation, or any type that signs call data in a `data`, `callData` or `functionSignature` field. Someone else submits the signed call and the contract treats it as coming from this account, so it can transfer tokens like a transaction. On mainnet, the typed-data switch keeps these with a person, like Safe transactions.

- Wallet approvals for a typed-data token permit or transfer authorization show **Valid until**, the time until which it can be used: an ERC-20 permit's deadline, a DAI permit's expiry, a Permit2 allowance's expiration or an EIP-3009 authorization's `validBefore`. A permit that never expires, such as a DAI permit with expiry 0 or a deadline set to the maximum integer, or whose end Hronaut cannot read, reads **Never expires** with a warning that it can still be used long after you sign it.

- A `browser_click` result now lists the tabs the clicked page opened while the click ran, through a `target="_blank"` link or `window.open`, under `tabsOpenedDuringClick`, so an agent can go straight to a popup instead of rescanning its tabs. It lists up to five tabs still open in the same workspace and counts further, closed, blocked and failed requests. A page timer that opens a tab during the click is listed too, and a popup that opens after the click returns is not. Clicks that open nothing return the same result as before.

### Fixed

- A TRON contract call that also sends TRX now shows that TRX as its native amount in the approval dialog. Before, a TRC-20 `transfer`, `approve` or `transferFrom` that also sent TRX showed only the token amount, and its simulation left the TRX out. A call that also sends a TRC-10 token is now shown as an unknown contract call, and a TRON amount above 2^53 − 1 sun is refused instead of being signed rounded.
- Adding a bounded wallet policy no longer erases a new draft you started typing while the previous policy was still saving. The form now clears only when it still holds the policy that was saved.

### Known issues

- Typed-data meta-transactions are recognized by type name, by a `bytes` call-data field named `data`, `callData`, `calldata` or `functionSignature`, or as a MetaMask delegation. One that uses another name and another field name is still signed on mainnet when **Also sign typed data on mainnet** is on, so that switch is not a general spending limit.
- Wallet policies saved by 2.45.0 or earlier that list a token method (`erc20.`, `trc20.` or `nft.`) do not sign token calls without a click. Remove such a policy and add it again with its token contract, or with **Allow any token contract**.
- Websites' raw `eth_sign`, Solana and TRON requests still need a person to approve, even under a website sign-in policy, and typed data is signed without a click only by a dedicated agent wallet with the typed-data switch on.
- Hronaut does not inject `window.tronLink` or `window.tronWeb` as a full TronWeb instance; Tron dApps that require TronLink specifically will not detect it.
- jsdom is held at 30.1.1 because 30.1.2 breaks focus in 6 Home page tests. This affects the test environment only.

## [2.46.0] - 2026-10-15

### Added

- A dedicated agent wallet can sign a website's EIP-712 typed data without a click when you opt in. A new, default-off **Also sign typed data without asking** switch on a website sign-in policy signs `eth_signTypedData_v4` requests from that policy's exact origin on EVM testnets and loopback local chains, only when the typed data is valid, quick to hash, at most 32 KiB and signs this wallet's chain ID, so an agent can test permit and order flows unattended. Managed wallets and imported keys that are not dedicated agent wallets still ask, and each signature counts toward the policy's operation limit. A second, separate **Also sign typed data on mainnet** switch with a warning extends this to a mainnet agent wallet under the mainnet sign-in limits: one origin, at most 100 operations and a seven-day expiry. On mainnet, permits with an unlimited or unreadable amount, and Safe transactions and messages, still ask.

- Wallet approvals for EIP-712 typed data warn when the request looks like a marketplace or exchange order (Seaport, Blur, 1inch, CoW Protocol, 0x or LooksRare), which anyone can fill to take the tokens or NFTs it offers, or a Safe multisig transaction or message, which can move the Safe's assets.

- Transaction approvals for token calls show the token contract, call an approval's destination the spender, and warn that a token approval lets the spender move the token later without asking. NFT `setApprovalForAll` calls are now recognized: granting access warns that the operator can move every NFT in the collection. ERC-20 `increaseAllowance` is recognized too, with a warning that it adds to any existing allowance.

### Changed

- An ERC-20 or TRC-20 approval of at least 2^160 − 1, not only the exact uint256 maximum, now counts as unlimited, so it always needs a person even when a bounded policy lists `erc20.approve`. A `setApprovalForAll` that grants access and every `increaseAllowance` also always need a person. A bounded policy that lists `nft.setApprovalForAll` can now sign a call that revokes an operator without a click.
- A bounded wallet policy signs a token call (`erc20.`, `trc20.` or `nft.` methods) without a click only when it also names the token contract in the new **Token contract** field. Before, a policy matched token calls by recipient or spender alone, so a policy meant for one token also covered any other token sent to the same address. A new policy for a token method must name its token contract, or turn the check off with a new default-off **Allow any token contract** switch, shown with a warning. Existing policies keep loading, but their token calls ask a person; remove such a policy and add it again with the token contract or the switch. Native transfers are unchanged. The destination field is now labelled **Recipient, spender or operator**.

### Fixed

- An agent reading a page's wallet requests with `wallet_page_requests` before it had account permission could see the wallet's address when a request named it, for example a transfer to the wallet itself. That source, destination or token contract now reads `this wallet (address hidden until account permission)` until the agent is granted access.

### Known issues

- Wallet policies saved by 2.45.0 or earlier that list a token method (`erc20.`, `trc20.` or `nft.`) no longer sign token calls without a click. Remove such a policy and add it again with its token contract, or with **Allow any token contract**.
- Websites' raw `eth_sign`, Solana and TRON requests still need a person to approve, even under a website sign-in policy, and typed data is signed without a click only by a dedicated agent wallet with the typed-data switch on.
- Hronaut does not inject `window.tronLink` or `window.tronWeb` as a full TronWeb instance; Tron dApps that require TronLink specifically will not detect it.
- jsdom is held at 30.1.1 because 30.1.2 breaks focus in 6 Home page tests. This affects the test environment only.

## [2.45.0] - 2026-10-15

### Added

- Websites can connect and sign in without a click when you opt in. A new, default-off **Let this site connect and sign in without asking** switch on a bounded wallet policy approves account connection and `personal_sign` sign-in messages from that policy's exact origin on EVM testnets and loopback local chains, so an agent can test a dApp's login flow unattended. A Sign-In with Ethereum message must name the requesting site, the wallet address and its chain; other plain text is signed without asking only by a dedicated agent wallet. Typed data, raw `eth_sign` and transactions still ask, each connection or signature counts toward the policy's operation limit, and granted access expires no later than the policy. A second, separate **Also allow on mainnet** switch with a warning extends this to a dedicated EVM mainnet agent wallet with one origin, at most 100 operations and a seven-day expiry.

- Wallet approvals show the text of a message to sign under **Message to sign** instead of only inside the raw request, and no longer call readable plain text undecodable. Hidden and direction-changing characters appear as visible `[U+XXXX]` codes with a warning, and a Sign-In with Ethereum or Solana message that names a different website, account or chain than the request gets a warning before you sign.

- Wallet approvals for EIP-712 typed data show the type, app, chain and contract under **Typed data to sign**. Token permits (ERC-20, DAI and Permit2) show the spender and each token and amount, and EIP-3009 transfer authorizations show the recipient and amount, with warnings that the signature lets your tokens be moved, when an amount is unlimited or cannot be read, and when the signature does not name the wallet's chain. The summary reads only the fields the signature covers, and reads amounts the way the signer does.

- The local wallet QA fixture has a **Sign in with Ethereum** button that signs an EIP-4361 message for the page's origin, connected account and chain, logging only whether a signature came back and its length. The wallet QA quickstart shows how to approve it by hand and how to let an agent sign in without a click.

- The local wallet QA fixture has a **Sign a token permit** button that asks the wallet to sign an EIP-2612 permit as typed data, so you can see the spender, amount and warnings Hronaut shows before approving. It logs only whether a signature came back and its length, and sends nothing on chain.

### Known issues

- Websites' EIP-712 typed data, raw `eth_sign`, Solana and TRON requests still need a person to approve, even under a website sign-in policy.
- Hronaut does not inject `window.tronLink` or `window.tronWeb` as a full TronWeb instance; Tron dApps that require TronLink specifically will not detect it.
- jsdom is held at 30.1.1 because 30.1.2 breaks focus in 6 Home page tests. This affects the test environment only.

## [2.44.0] - 2026-10-15

### Added

- `browser_emulate` can emulate mobile browser controls for viewport units (`smallViewportHeightDifference`, 0–1000 CSS px): `100lvh` becomes that much taller than `100svh` in one tab, for full-height mobile layout QA. Top-level frame only; `dvh` and address-bar animation are not emulated (#766).

- `wallet_balance` reads TRC-20 token balances on TRON wallets too, with decimals and symbol, alongside ERC-20 and SPL tokens.

- `browser_live_region` records the text of one selected status, loading or result region at each DOM mutation callback, so an agent can review transient updates that a later snapshot misses. Start it with a selector for exactly one region; form fields, editable content, frames, scripts and styles are never read, and reads, observations and duration are bounded. Selected text can be private, so it is never persisted, exported or logged, and navigation, element removal, pausing the agent or a workspace control change stops and releases it. If the region later becomes editable, recording stops before reading it. Results are DOM observations, not screen-reader announcements (#688).

- `browser_css_state_preview` forces `:hover` and/or `:active` styling on one selected element for up to a minute, so an agent can inspect or capture a component's hover or pressed look without moving the pointer. No input events are sent and focus does not change. The address bar shows `Forced :hover` while it is active and lets the person end it, and it also ends on expiry, navigation, removal of the element, pausing the agent or opening Developer Tools. Screenshots, element inspection and visual comparison taken meanwhile are marked with `cssStatePreview` (#478).

- `browser_new_tab` takes an optional `defaultFontSize` (9–72 CSS px) that sets the browser default text size for that tab only, so an agent can check a page at 24px or 32px the way a person with a larger browser font setting sees it. Text sized by the browser default and `em`/`rem` media queries follow it; authored pixel sizes do not. It survives navigation, reload, sleep, duplicating, reopening a closed tab and restart, and the zoom bar shows it (#771).

### Known issues

- Websites still need a person to approve every account connection and message signature, including Sign-In with Ethereum and Sign-In with Solana, even on testnets and local chains.
- Hronaut does not inject `window.tronLink` or `window.tronWeb` as a full TronWeb instance; Tron dApps that require TronLink specifically will not detect it.
- jsdom is held at 30.1.1 because 30.1.2 breaks focus in 6 Home page tests. This affects the test environment only.

## [2.43.0] - 2026-10-15

### Added

- `wallet_balance` takes an optional `token` and returns that ERC-20 (EVM) or SPL mint (Solana) balance with its decimals and symbol, so an agent testing a dApp can check that a swap, mint or faucet credited the wallet. It uses the same human-approved account permission as the native balance; RPC details stay out of errors.

- Sign-In with Solana: the Solana wallet supports the Wallet Standard `solana:signIn` feature. Hronaut writes the sign-in text for the requesting site's own domain, rejects another site's domain or address, and the person approves the exact text before it is signed.

- The Solana Wallet Standard wallet advertises version 0 transactions as well as legacy ones, so dApps that build versioned transactions (most current Solana apps) can ask Hronaut to sign them. Undecodable transactions still need human approval.

- The EVM wallet provider answers `wallet_addEthereumChain` (switching to a network already configured on a workspace wallet; websites still cannot add networks or RPC URLs), the EIP-2255 `wallet_getPermissions`, `wallet_requestPermissions` and `wallet_revokePermissions` methods for `eth_accounts`, and the legacy `enable()`, `isConnected()` and `off()` helpers, so more dApps connect without a fallback path.

- dApp pages can read chain state through Hronaut's EVM wallet provider: block number, balances, `eth_call`, gas estimates, receipts, blocks and logs are forwarded to the active wallet network's RPC, so wagmi, viem and ethers reads work without a separate RPC. Reads need no account permission and never sign; revert codes and data reach the page, the RPC URL does not.

- `wallet_page_requests` lets an agent that is testing a dApp see which wallet requests the page made (connect, sign message or typed data, sign or send transaction), with status and transaction hash, for the same tab and page only. It is read-only, and approval stays with a person in Hronaut.

### Known issues

- Websites still need a person to approve every account connection and message signature, including Sign-In with Ethereum and Sign-In with Solana, even on testnets and local chains.
- Token balances cover ERC-20 on EVM and SPL mints on Solana. TRON token balances are not supported yet.
- Hronaut does not inject `window.tronLink` or `window.tronWeb` as a full TronWeb instance; Tron dApps that require TronLink specifically will not detect it.
- jsdom is held at 30.1.1 because 30.1.2 breaks focus in 6 Home page tests. This affects the test environment only.

## [2.42.0] - 2026-10-15

### Added

- `browser_emulate` can emulate the operating-system text-size preference (`osTextScale`, 85–200%) in one tab, for pages that opt in with the `text-scale` meta tag or `env(preferred-text-scale)`. It survives navigation, shows in the tab's emulation summary, and is cleared with `null` or `reset: true` (#715).

- `browser_emulate` can override a tab's safe-area insets (`env(safe-area-inset-*)` and the max variants) for notch and home-indicator layout QA. The override stays in that tab, survives navigation, and is cleared with `null` or `reset: true` (#745).

### Changed

- Show the tab's Lock input, Pause agents, Freeze and Mute toggles as icon buttons at every window width, with tooltips and pressed states. The toolbar stays on one row at 1440 px, the address gets that room, and page freeze has its own snowflake icon instead of sharing the pause icon. Every existing command is kept.

### Fixed

- Wait for workspace initialization before answering startup collection and layout reads, avoiding spurious startup warnings while retaining fail-closed mutation and sender checks.

- The page zoom button's accessible name now includes the visible percentage, and the workspace header's visible name and tab count are separated, so both pass the label-in-name check (WCAG 2.5.3) that axe-core 4.14 adds. Voice-control users can say what they see.

- Allow Close workspace in Edit workspace while all tabs are locked, matching Home’s Clear…. The button was disabled with only a tooltip, so the same workspace could be cleared from Home but not from its editor. The confirmation still applies, and deletion protection still blocks it.

- Vertically centre “MCP ready” with “Pause agents” in the MCP status pill; the status sat 4.5 px lower in the top-tab layout.

### Known issues

- OS text-scale emulation only affects pages that opt in with the `text-scale` meta tag or read `env(preferred-text-scale)`. Clearing was verified on Linux, where the native preference is 100%; restoring a different underlying OS preference has not been reproduced.
- Safe-area emulation sets `env()` values only. It draws no device frame or notch, and omitted fields are 0px, so `env()` fallbacks never apply while an override is active.
- jsdom is held at 30.1.1 because 30.1.2 breaks focus in 6 Home page tests. This affects the test environment only.

## [2.41.0] - 2026-10-15

### Added

- Create tabs whose page zoom is independent of other same-origin tabs with `browser_new_tab` `zoomIsolated: true`. Isolation is fixed at creation, kept across navigation, duplicate, reopen and restart, and shown in the zoom bar.

- Report HTTP Basic authentication challenges in `browser_issues` as `authChallenges`, with origin and request kind only. Hronaut still cancels the challenge and never prompts for or supplies credentials.

- Compare one rendered native text input or textarea with a caller-supplied `expectedValue` in `browser_element_inspect`. Only `match`, `mismatch` or `unavailable` is returned; neither value is echoed, and sensitive controls are excluded.

- Delete one non-HttpOnly cookie by its exact listed domain and path with `browser_storage`, leaving same-name cookies on other paths untouched. Partitioned, ambiguous and HttpOnly identities are rejected before deletion; name-only deletion is unchanged.

- Add opt-in selected-element computed sizing inputs to element inspection, without inferring flex participation or collecting parent context.

### Fixed

- Keep snapshot refs stable for surviving controls within a document, so inserting or removing an earlier control no longer makes every later control appear updated in snapshot deltas. Identity stays outside page JavaScript; replaced or cloned nodes receive new refs.

- Stop startup with recovery guidance when saved workspace metadata is unreadable, invalid, or from an unsupported version, preserving the metadata and workspace storage instead of replacing them with a fresh workspace.

- Preserve enforced, report-only, or unknown CSP disposition in browser issues, the Issues panel, and copied JSON without changing severity.

- Remove residual files for explicitly deleted workspaces on a later startup, after checking storage ownership and recovery metadata. Active and archived workspaces are preserved; ambiguous or unsafe profiles defer cleanup. This is file removal, not secure erasure.

- Keep Page tools search, results, and footer scrollable in short docks while close and dock controls remain available.

- Keep top and bottom diagnostic docks from collapsing in short windows. Constrained layouts give the panel more space while reserving at least one third of the available height for the native website; normal-height layouts and saved dock sizes are preserved. Network copy, footer and header actions remain reachable at the minimum window size and 125% interface scale.

### Known issues

- Stable snapshot refs apply within one document only. A new document restarts numbering at `e1`, a replaced or cloned node gets a new ref, and numbering restarts after one million refs in one document. A stable ref is comparison evidence, not permission to act or proof that an element's meaning is unchanged.
- Exact cookie deletion needs Chromium's debugging connection and is unavailable while Developer Tools is open for the tab. Partitioned and ambiguous identities are rejected rather than deleted.
- Expected value comparison returns a match bit that can confirm a guessed value. It is limited to non-sensitive text inputs and textareas and is a point-in-time observation, not proof of saving or server acceptance.
- HTTP Basic challenge observation records only Basic, non-proxy challenges. Subframe and subresource challenges during a pending top-level navigation are not attributed, and an empty list does not prove that no challenge occurred.
- Isolated page zoom is fixed at tab creation. Its propagation through restart, workspace restore, duplicate and reopen is covered by persistence unit tests and code review, not by an Electron restart test. Older versions reopen such tabs with shared zoom.

- Native image state is a sampled observation of one current top-level light-DOM HTML image, not a loaded, decoded, rendered or future-readiness verdict. Frames, shadow descendants and non-HTML image types are unsupported. Native source strings can be materialized before reduction to a boolean; selector limits do not bound selector CPU cost. Deadlines withhold late results without interrupting renderer work, and unsettled work retains capacity. Image or DOM state can change between the final renderer check and delivery; observations are not atomic compositor evidence. The full sampling, admission and resource limits remain documented in REFERENCE.md.
- Labeled MCP tab creation can create and navigate a tab even when its label save or final publication fails. A committed file replacement can settle after cancellation or authority loss; an unknown outcome does not imply rollback. The saved label can later be changed by a human. Cancellation retains admitted persistence ownership until actual filesystem settlement, potentially indefinitely. Inspect existing state rather than automatically repeating creation to retry a label; durability-unconfirmed and not-saved outcomes have distinct meanings.
- Retained emulation settings are not proof of native application after an interrupted operation. Explicit recovery restores the last committed settings without replaying the failed request or undoing effects already submitted. Unknown network application requires separate explicit condition clearing before emulation recovery. A later queued change can supersede an acknowledged operation before publication; inspect current health instead of automatically replaying it.

- Native right-click is supported only on Linux under the documented already-active, visible, awake, locked-tab and default-geometry restrictions. Opening a page menu and selecting an item are separate authorized actions. Unrestricted click capabilities grant both supported buttons; exact button constraints restrict them. Target sampling is not atomic routing or a handler-execution guarantee. One best-effort matching release can fail during preparation or acknowledgement, leaving physical button/compositor state uncertain; quarantine does not prove restoration. A release acknowledgement does not establish original press success. Cancellation or disconnect retains ownership until actual native settlement, possibly indefinitely. Never automatically replay. Alternate event ordering and unsupported-platform discrimination have controlled source tests, not native Windows/macOS support.
- File-source evaluation requires Linux procfs and a separately authorized exact source tuple; ordinary inline-evaluation permissions do not grant it. Captured source is strict UTF-8, at most 65,536 bytes, and submitted once to the original document context without fallback. Linux-mounted paths can include network, FUSE and pseudo filesystems: local-disk provenance is not established. Acquisition and execution deadlines cannot cancel native filesystem/CDP work or undo submitted effects; pending operations can retain two process-wide acquisition slots, separately two pending-evaluation slots, and workspace ownership indefinitely. Unconfirmed handle closure quarantines capacity. Intervening human-waiting service requests can invalidate review certificates. A byte hash is not a safety/authorship guarantee, expected origin is not a network-egress boundary, and a returned script result does not prove an application postcondition. No automatic replay is authorized after rejection, interruption or uncertain effects. The full admission, cancellation and publication limits remain documented in REFERENCE.md.
- Copy cURL continues to require POSIX-shell syntax. Sanitized copies intentionally omit sensitive and transport headers and do not promise original wire-byte fidelity or PowerShell compatibility.

- Native wheel and key-hold bounds do not establish a transport deadline. A pending CDP command can retain the debugger queue indefinitely; cancellation does not release it, and lock preparation can time out. No bounded cleanup or transport recovery is promised. Inspect fresh state after uncertain or missing responses; never automatically replay a potentially effective action.
- The earlier local key-hold fresh-call failure remains unclassified. Later controlled probes and green runs verify current guards, not that historical failure's cause or a repair.
- A controlled initial-load semantic-click probe reproduced a document commit during preparation. Readiness waits preserve the setup for human-takeover and dialog tests, but the original CI human-click response and dispatch timeline were not captured. The local probe and later green runs do not establish every earlier failure's cause.
- Historical native input observations during pending lock requests do not establish input origin. Tests now retain observations from compositor lock acknowledgement through terminal server activity; later passing runs do not prove the original cause or a product repair. Identical event shapes remain ambiguous, and the concurrent mouse-input gap remains; use Pause agents for explicit takeover.
- Historical endpoint-startup and first-video-preview pixel failures remain unexplained. Restart ownership and first-presented-frame checks strengthen test evidence; controlled reproductions and later green runs do not establish the original event sequence or a product repair.
- The historical cross-origin-frame immediate parent click-count miss, native screenshot UnknownVizError, resize/evaluate stalls, destroyed-context failures and superseded-navigation ERR_ABORTED success-state behavior remain unresolved. No native-click routing or capture repair is claimed.

## [2.40.0] - 2026-10-13

### Added

- Accept optional task labels during MCP tab creation, with exact created-tab identity and explicit saved, unconfirmed-durability or failed-label outcomes. Cancellation retains pending persistence ownership; late authority loss never implies creation or disk rollback.

- Add bounded, passive `browser_image_state` observations of one image’s native completion and density-corrected intrinsic dimensions without returning source URLs. Reports explicitly retain sampled-state and publication-gap limits.

### Fixed

- Keep Network request details and HAR actions reachable in short left and right docks at enlarged interface scale. The footer scrolls with the details when there is not enough height, while the header controls stay available.

- Identify the POSIX-shell requirement in the Network panel’s cURL copy action and copied feedback in every supported language.

- Reject sanitized cURL copies containing retained literal NUL characters instead of producing an unusable shell command. Show an explicit error without changing the clipboard; Copy fetch preserves the retained body, including NUL characters.

- Separate retained emulation settings from confirmed native application after interrupted changes. Show pending or unknown application instead of reporting retained settings as applied; explicit restoration preserves the last committed configuration without replaying the failed request. Network uncertainty requires its own recovery.

### Known issues

- Native image state is a sampled observation of one current top-level light-DOM HTML image, not a loaded, decoded, rendered or future-readiness verdict. Frames, shadow descendants and non-HTML image types are unsupported. Native source strings can be materialized before reduction to a boolean; selector limits do not bound selector CPU cost. Deadlines withhold late results without interrupting renderer work, and unsettled work retains capacity. Image or DOM state can change between the final renderer check and delivery; observations are not atomic compositor evidence. The full sampling, admission and resource limits remain documented in REFERENCE.md.
- Labeled MCP tab creation can create and navigate a tab even when its label save or final publication fails. A committed file replacement can settle after cancellation or authority loss; an unknown outcome does not imply rollback. The saved label can later be changed by a human. Cancellation retains admitted persistence ownership until actual filesystem settlement, potentially indefinitely. Inspect existing state rather than automatically repeating creation to retry a label; durability-unconfirmed and not-saved outcomes have distinct meanings.
- Retained emulation settings are not proof of native application after an interrupted operation. Explicit recovery restores the last committed settings without replaying the failed request or undoing effects already submitted. Unknown network application requires separate explicit condition clearing before emulation recovery. A later queued change can supersede an acknowledged operation before publication; inspect current health instead of automatically replaying it.
- The Network layout repair covers short left/right docks. Top/bottom diagnostic docks can still collapse at the minimum window size and enlarged interface scale because of shared space allocation; this remains unresolved in [#724](https://github.com/hronaut/hronaut/issues/724). The new footer regression establishes reachability and keyboard focus, not execution of Save HAR.

- Native right-click is supported only on Linux under the documented already-active, visible, awake, locked-tab and default-geometry restrictions. Opening a page menu and selecting an item are separate authorized actions. Unrestricted click capabilities grant both supported buttons; exact button constraints restrict them. Target sampling is not atomic routing or a handler-execution guarantee. One best-effort matching release can fail during preparation or acknowledgement, leaving physical button/compositor state uncertain; quarantine does not prove restoration. A release acknowledgement does not establish original press success. Cancellation or disconnect retains ownership until actual native settlement, possibly indefinitely. Never automatically replay. Alternate event ordering and unsupported-platform discrimination have controlled source tests, not native Windows/macOS support.
- File-source evaluation requires Linux procfs and a separately authorized exact source tuple; ordinary inline-evaluation permissions do not grant it. Captured source is strict UTF-8, at most 65,536 bytes, and submitted once to the original document context without fallback. Linux-mounted paths can include network, FUSE and pseudo filesystems: local-disk provenance is not established. Acquisition and execution deadlines cannot cancel native filesystem/CDP work or undo submitted effects; pending operations can retain two process-wide acquisition slots, separately two pending-evaluation slots, and workspace ownership indefinitely. Unconfirmed handle closure quarantines capacity. Intervening human-waiting service requests can invalidate review certificates. A byte hash is not a safety/authorship guarantee, expected origin is not a network-egress boundary, and a returned script result does not prove an application postcondition. No automatic replay is authorized after rejection, interruption or uncertain effects. The full admission, cancellation and publication limits remain documented in REFERENCE.md.
- Copy cURL continues to require POSIX-shell syntax. Sanitized copies intentionally omit sensitive and transport headers and do not promise original wire-byte fidelity or PowerShell compatibility.

- Native wheel and key-hold bounds do not establish a transport deadline. A pending CDP command can retain the debugger queue indefinitely; cancellation does not release it, and lock preparation can time out. No bounded cleanup or transport recovery is promised. Inspect fresh state after uncertain or missing responses; never automatically replay a potentially effective action.
- The earlier local key-hold fresh-call failure remains unclassified. Later controlled probes and green runs verify current guards, not that historical failure's cause or a repair.
- A controlled initial-load semantic-click probe reproduced a document commit during preparation. Readiness waits preserve the setup for human-takeover and dialog tests, but the original CI human-click response and dispatch timeline were not captured. The local probe and later green runs do not establish every earlier failure's cause.
- Historical native input observations during pending lock requests do not establish input origin. Tests now retain observations from compositor lock acknowledgement through terminal server activity; later passing runs do not prove the original cause or a product repair. Identical event shapes remain ambiguous, and the concurrent mouse-input gap remains; use Pause agents for explicit takeover.
- Historical endpoint-startup and first-video-preview pixel failures remain unexplained. Restart ownership and first-presented-frame checks strengthen test evidence; controlled reproductions and later green runs do not establish the original event sequence or a product repair.
- The historical cross-origin-frame immediate parent click-count miss, native screenshot UnknownVizError, resize/evaluate stalls, destroyed-context failures and superseded-navigation ERR_ABORTED success-state behavior remain unresolved. No native-click routing or capture repair is claimed.

## [2.39.0] - 2026-10-13

### Added

- Add explicit native right-click for page-authored menus on Linux, limited to an already active visible awake locked tab with default geometry. Menu selection remains a separate action; uncertain input owns one best-effort matching release and never replays automatically.

- Add Linux file-source JavaScript evaluation with a separate exact-tuple capability grant, bounded UTF-8 acquisition and document-bound dispatch. Cancellation retains pending native work and uncertain effects never permit automatic replay.

- Add independent task labels to website tabs from Search tabs. Labels are searchable, remain separate from page titles and addresses, survive navigation and session restoration, and carry through duplication and workspace archiving. Failed saves preserve the previous label; file replacement with an unconfirmed directory flush retains the new label with a durability warning.

### Fixed

- Preserve explicitly empty retained HTTP headers in sanitized cURL copies instead of silently omitting them during replay. Secret and transport headers remain omitted.

- Preserve keyboard focus on retained account-chooser controls when saved-account metadata updates. Removed accounts still return focus to search; updates never activate an account.

### Known issues

- Native right-click is supported only on Linux under the documented already-active, visible, awake, locked-tab and default-geometry restrictions. Opening a page menu and selecting an item are separate authorized actions. Unrestricted click capabilities grant both supported buttons; exact button constraints restrict them. Target sampling is not atomic routing or a handler-execution guarantee. One best-effort matching release can fail during preparation or acknowledgement, leaving physical button/compositor state uncertain; quarantine does not prove restoration. A release acknowledgement does not establish original press success. Cancellation or disconnect retains ownership until actual native settlement, possibly indefinitely. Never automatically replay. Alternate event ordering and unsupported-platform discrimination have controlled source tests, not native Windows/macOS support.
- File-source evaluation requires Linux procfs and a separately authorized exact source tuple; ordinary inline-evaluation permissions do not grant it. Captured source is strict UTF-8, at most 65,536 bytes, and submitted once to the original document context without fallback. Linux-mounted paths can include network, FUSE and pseudo filesystems: local-disk provenance is not established. Acquisition and execution deadlines cannot cancel native filesystem/CDP work or undo submitted effects; pending operations can retain two process-wide acquisition slots, separately two pending-evaluation slots, and workspace ownership indefinitely. Unconfirmed handle closure quarantines capacity. Intervening human-waiting service requests can invalidate review certificates. A byte hash is not a safety/authorship guarantee, expected origin is not a network-egress boundary, and a returned script result does not prove an application postcondition. No automatic replay is authorized after rejection, interruption or uncertain effects. The full admission, cancellation and publication limits remain documented in REFERENCE.md.
- Copy cURL continues to require POSIX-shell syntax. Sanitized copies intentionally omit sensitive and transport headers and do not promise original wire-byte fidelity or PowerShell compatibility.

- Native wheel and key-hold bounds do not establish a transport deadline. A pending CDP command can retain the debugger queue indefinitely; cancellation does not release it, and lock preparation can time out. No bounded cleanup or transport recovery is promised. Inspect fresh state after uncertain or missing responses; never automatically replay a potentially effective action.
- The earlier local key-hold fresh-call failure remains unclassified. Later controlled probes and green runs verify current guards, not that historical failure's cause or a repair.
- A controlled initial-load semantic-click probe reproduced a document commit during preparation. Readiness waits preserve the setup for human-takeover and dialog tests, but the original CI human-click response and dispatch timeline were not captured. The local probe and later green runs do not establish every earlier failure's cause.
- Historical native input observations during pending lock requests do not establish input origin. Tests now retain observations from compositor lock acknowledgement through terminal server activity; later passing runs do not prove the original cause or a product repair. Identical event shapes remain ambiguous, and the concurrent mouse-input gap remains; use Pause agents for explicit takeover.
- Historical endpoint-startup and first-video-preview pixel failures remain unexplained. Restart ownership and first-presented-frame checks strengthen test evidence; controlled reproductions and later green runs do not establish the original event sequence or a product repair.
- The historical cross-origin-frame immediate parent click-count miss, native screenshot UnknownVizError, resize/evaluate stalls, destroyed-context failures and superseded-navigation ERR_ABORTED success-state behavior remain unresolved. No native-click routing or capture repair is claimed.

## [2.38.2] - 2026-10-12

### Fixed

- Keep late bookmark title/address save errors from appearing after Escape or a collection change dismisses that editor. Successful in-flight edits remain saved; dismissal does not cancel persistence or roll back changes.

- Keep late bookmark-collection save errors from reappearing after the editor is cancelled. Cancel dismisses the editor; a successful in-flight save still updates the collection list and is not rolled back.

- Withhold storage-comparison results when page or agent authority changes through audit settlement and final publication. Interrupted captures preserve completed baselines; failures report whether this operation already changed the in-memory comparison, without rollback or automatic replay.

- Reject pending storage baseline and comparison captures when their document changes between reads or before saving. Completed same-origin baselines and comparisons remain available; storage reads are sequential, not atomic.

- Reject known covered or replaced semantic native-click targets before each press using the retained original element and isolated hit sampling. Partial clicks report attempted and acknowledged input separately, preserve cleanup uncertainty, and never replay automatically. Sampling is not atomic: later page changes can still redirect input. Only text/html documents are supported; embedded and shadow receivers are conservatively unsupported. Unconfirmed cleanup blocks further semantic native clicks on that tab.

### Known issues

- Native wheel and key-hold bounds do not establish a transport deadline. A pending CDP command can retain the debugger queue indefinitely; cancellation does not release it, and lock preparation can time out. No bounded cleanup or transport recovery is promised. Inspect fresh state after uncertain or missing responses; never automatically replay a potentially effective action.
- The earlier local key-hold fresh-call failure remains unclassified. Later controlled probes and green runs verify current guards, not that historical failure's cause or a repair.
- A controlled initial-load semantic-click probe reproduced a document commit during preparation. Readiness waits preserve the setup for human-takeover and dialog tests, but the original CI human-click response and dispatch timeline were not captured. The local probe and later green runs do not establish every earlier failure's cause.
- Historical native input observations during pending lock requests do not establish input origin. Tests now retain observations from compositor lock acknowledgement through terminal server activity; later passing runs do not prove the original cause or a product repair. Identical event shapes remain ambiguous, and the concurrent mouse-input gap remains; use Pause agents for explicit takeover.
- Historical endpoint-startup and first-video-preview pixel failures remain unexplained. Restart ownership and first-presented-frame checks strengthen test evidence; controlled reproductions and later green runs do not establish the original event sequence or a product repair.
- The historical cross-origin-frame immediate parent click-count miss, native screenshot UnknownVizError, resize/evaluate stalls, destroyed-context failures and superseded-navigation ERR_ABORTED success-state behavior remain unresolved. No native-click routing or capture repair is claimed.

## [2.38.1] - 2026-10-12

### Fixed

- Withhold IndexedDB and storage-usage observations if page, workspace access, control or cancellation changes before publication. Quota fallback stops after authority is revoked; interrupted reads report no mutation.

- Withhold local and session storage results when document, workspace, control or cancellation state changes before publication. Reads discard stale data; submitted mutations report possible effects with execution provenance and no automatic replay.

- Stop pending cookie edits when their document, workspace access, pause state or MCP control changes. Interrupted edits retain native-write counts and uncertain outcomes without replay; results are withheld if those checks fail during settlement. Concurrent cookie-session changes after initial admission remain outside these checks.
- Match the Downloads save-mode confirmation to the current authoritative setting when another change arrives before an earlier response completes.
- Keep a newer MCP port draft free of error feedback from an earlier failed Apply port request. Failures still appear when their submitted draft is unchanged; no listener change is retried automatically.

### Known issues

- Native wheel and key-hold bounds do not establish a transport deadline. A pending CDP command can retain the debugger queue indefinitely; cancellation does not release it, and lock preparation can time out. No bounded cleanup or transport recovery is promised. Inspect fresh state after uncertain or missing responses; never automatically replay a potentially effective action.
- The earlier local key-hold fresh-call failure remains unclassified. Later controlled probes and green runs verify current guards, not that historical failure's cause or a repair.
- A controlled initial-load semantic-click probe reproduced a document commit during preparation. Readiness waits preserve the setup for human-takeover and dialog tests, but the original CI human-click response and dispatch timeline were not captured. The local probe and later green runs do not establish every earlier failure's cause.
- Historical native input observations during pending lock requests do not establish input origin. Tests now retain observations from compositor lock acknowledgement through terminal server activity; later passing runs do not prove the original cause or a product repair. Identical event shapes remain ambiguous, and the concurrent mouse-input gap remains; use Pause agents for explicit takeover.
- Historical endpoint-startup and first-video-preview pixel failures remain unexplained. Restart ownership and first-presented-frame checks strengthen test evidence; controlled reproductions and later green runs do not establish the original event sequence or a product repair.
- The historical cross-origin-frame immediate parent click-count miss, native screenshot UnknownVizError, resize/evaluate stalls, destroyed-context failures and superseded-navigation ERR_ABORTED success-state behavior remain unresolved. No native-click routing or capture repair is claimed.

## [2.38.0] - 2026-10-12

### Added

- Enable or disable retained Network conditions without rebuilding private mocks, changing priority or resetting remaining matches. Toggles require confirmed native application; explicit clear remains the recovery path.

- Semantically replace or clear a bounded exact option set in one native multiple-select control using `browser_select.values`. Validate the full set before mutation, preserve disabled-control rules, and report uncertain handler or authority changes without replay. No native gesture fidelity is claimed.

### Fixed

- Distinguish retained Network conditions from confirmed native application. Interrupted or partially acknowledged changes stay visibly unconfirmed, including an empty list; explicit clear recovery preserves tab-wide emulation and warns that future requests may reach their normal destination. Do not retry uncertain native commands or paused-request dispositions automatically.

- Finish best-effort renderer input-flag cleanup when its original page is destroyed, so closing during cleanup cannot leave native input waiting on a vanished document. Preserve release acknowledgements, uncertain outcomes, and focus restoration without retrying input.
- Keep successful Network condition additions and removals committed when a later browser-state refresh fails. Clear only the submitted add draft, preserve newer edits, and report the refresh failure separately so a saved condition is not mistaken for a failed change.
- Verify an exact website release publication time against GitHub's published release record. An explicitly unknown fallback time remains unknown while every release identity, asset, and download redirect is still checked; an upload timestamp cannot pass as publication time.

### Known issues

- Native wheel and key-hold bounds do not establish a transport deadline. A pending CDP command can retain the debugger queue indefinitely; cancellation does not release it, and lock preparation can time out. No bounded cleanup or transport recovery is promised. Inspect fresh state after uncertain or missing responses; never automatically replay a potentially effective action.
- The earlier local key-hold fresh-call failure remains unclassified. Later controlled probes and green runs verify current guards, not that historical failure's cause or a repair.
- A controlled initial-load semantic-click probe reproduced a document commit during preparation. Readiness waits preserve the setup for human-takeover and dialog tests, but the original CI human-click response and dispatch timeline were not captured. The local probe and later green runs do not establish every earlier failure's cause.
- Historical native input observations during pending lock requests do not establish input origin. Tests now retain observations from compositor lock acknowledgement through terminal server activity; later passing runs do not prove the original cause or a product repair. Identical event shapes remain ambiguous, and the concurrent mouse-input gap remains; use Pause agents for explicit takeover.
- Historical endpoint-startup and first-video-preview pixel failures remain unexplained. Restart ownership and first-presented-frame checks strengthen test evidence; controlled reproductions and later green runs do not establish the original event sequence or a product repair.
- The historical cross-origin-frame immediate parent click-count miss, native screenshot UnknownVizError, resize/evaluate stalls, destroyed-context failures and superseded-navigation ERR_ABORTED success-state behavior remain unresolved. No native-click routing or capture repair is claimed.

## [2.37.0] - 2026-10-12

### Added

- Request an integer 1–5000 ms hold of one nonmodifier key with `browser_hold_key` in QA and complete MCP tool sets. The active visible, already awake page outside split view, without child frames, receives one raw down and matching release, without text or auto-repeat; native selections and Developer Tools must be closed. Authority or lock requests interrupt the timed wait. Human input guards stay active. Unconfirmed release blocks further holds until the tab is closed. Ordinary `browser_press` is unchanged.
- Send one bounded native wheel gesture with `browser_wheel` in the QA and complete MCP tool sets. Canvas wheel handlers and nested scrollers receive explicit viewport coordinates and signed CSS-pixel deltas. This first version requires the active visible, human-unlocked, already awake page outside split view and without child frames, default zoom, no emulation overrides and display scale 1. It never unlocks, focuses, moves the pointer or retries; uncertain dispatch requires fresh inspection. `browser_scroll` retains its CSSOM behavior.

### Fixed

- Preserve the selected browser-import destination when workspace transfer loading finishes after a newer editor opens or the destination changes.
- Reject semantic clicks when pause, navigation, or workspace authority changes during asynchronous click preparation, including dialog-handling clicks; uncertain actions are never replayed automatically.
- Withhold screenshots and page snapshots if workspace authority, agent control or cancellation changes while audit persistence is finishing.

### Known issues

- Native wheel and key-hold bounds do not establish a transport deadline. A pending CDP command can retain the debugger queue indefinitely; cancellation does not release it, and lock preparation can time out. No bounded cleanup or transport recovery is promised. Inspect fresh state after uncertain or missing responses; never automatically replay a potentially effective action.
- The earlier local key-hold fresh-call failure remains unclassified. Later controlled probes and green runs verify current guards, not that historical failure's cause or a repair.
- A controlled initial-load semantic-click probe reproduced a document commit during preparation. Readiness waits preserve the setup for human-takeover and dialog tests, but the original CI human-click response and dispatch timeline were not captured. The local probe and later green runs do not establish every earlier failure's cause.
- Historical native input observations during pending lock requests do not establish input origin. Tests now retain observations from compositor lock acknowledgement through terminal server activity; later passing runs do not prove the original cause or a product repair. Identical event shapes remain ambiguous, and the concurrent mouse-input gap remains; use Pause agents for explicit takeover.
- Historical endpoint-startup and first-video-preview pixel failures remain unexplained. Restart ownership and first-presented-frame checks strengthen test evidence; controlled reproductions and later green runs do not establish the original event sequence or a product repair.
- The historical cross-origin-frame immediate parent click-count miss, native screenshot UnknownVizError, resize/evaluate stalls, destroyed-context failures and superseded-navigation ERR_ABORTED success-state behavior remain unresolved. No native-click routing or capture repair is claimed.

## [2.36.0] - 2026-10-11

### Added

- Opt in to compact MCP tab discovery with `browser_tabs`'s `search` argument. Match bounded title/address projections by literal words within one authorized workspace, with explicit counts and truncation, without waking or selecting tabs. URL-derived fallback titles are omitted; credentials, fragments and recognized secret query values are removed from addresses before matching. Explicit page-authored titles and paths may still contain private information. Existing calls retain full tab state.

### Fixed

- Keep Settings open when the first browser state arrives after an early gear click. Later tab switches and explicit Home/New Tab actions still close Settings.
- Recheck native hover, drag and key input authority after asynchronous preparation and before each dispatch. Stop later input when pause, workspace access, cancellation or navigation changes; release an already-pressed button or key once without replaying the action.
- Attempt one matching native button/key release when the down event succeeds but restoring the input lock fails. Keep the outcome uncertain and prevent automatic replay, including when that cleanup release also fails.

- Recheck file-upload authority and captured tab/document context immediately before assigning files. Pause, access revocation, cancellation or context changes during asynchronous preparation now prevent the commit and retain conservative no-retry outcome reporting.

### Known issues

- Historical native input observations during pending lock requests do not establish input origin. Tests now retain observations from compositor lock acknowledgement through terminal server activity; later passing runs do not prove the original cause or a product repair. Identical event shapes remain ambiguous, and the concurrent mouse-input gap remains; use Pause agents for explicit takeover.
- Historical endpoint-startup and first-video-preview pixel failures remain unexplained. Restart ownership and first-presented-frame checks strengthen test evidence; controlled reproductions and later green runs do not establish the original event sequence or a product repair.
- The historical cross-origin-frame immediate parent click-count miss, native screenshot UnknownVizError, resize/evaluate stalls, destroyed-context failures and superseded-navigation ERR_ABORTED success-state behavior remain unresolved. No native-click routing or capture repair is claimed.

## [2.35.0] - 2026-10-11

### Added

- Filter Network requests and sanitized HAR exports by exact observed response source with `response-source:network`, `response-source:disk-cache`, `response-source:prefetch-cache`, `response-source:service-worker`, or `response-source:other-cache`. Negation and existing AND filters are supported without guessing unavailable sources or generating traffic.

### Fixed

- Closing Debug report, Quality audit, Issues, Repro recorder, or DOM changes now retires pending text-copy feedback and clears prior copy success. Late clipboard replies cannot restore success or show an obsolete error after close/reopen; retained reports and recorder state remain available.

- Retire pending Network copies when closing the panel: unfinished HAR exports no longer start a clipboard write after close, and late clipboard replies cannot revive old success or error feedback. Retained requests, selection and filters remain available; already-dispatched clipboard writes and pending file saves are not undone.

- Retire Console copy feedback when closing the panel, so a delayed clipboard result cannot restore an old “Copied” indicator or display an obsolete error after closing or reopening. Clipboard writes already dispatched are not undone; retained messages and filters are preserved.

- Keep Network condition controls busy and retain their displayed list while a condition edit is pending. Overlapping refreshes coalesce into one read after settlement, so uncommitted conditions stay hidden and rules consumed or changed during state synchronization are reconciled without clearing a mutation error or newer draft.

### Known issues

- A cross-origin-frame native-click test failed its immediate parent-page click-count assertion on the first attempt in main CI 38115599919. The instrumented baseline/barrier comparison did not reproduce that failure; its cause remains unresolved. Later passing candidates do not establish a repair.
- An intermittent native screenshot UnknownVizError remains unexplained. Controlled and original-order diagnostics did not reproduce it; no capture fix is claimed.
- Historical resize/evaluate stalls, destroyed-context and endpoint-startup failures remain unexplained; later passing checks do not establish their cause or a repair. Superseded-navigation ERR_ABORTED success-state behavior is also unresolved.
- Native keyboard event-shape matching does not prove input origin; identical shapes remain ambiguous and the concurrent mouse-input gap remains. Use Pause agents for explicit takeover. This release does not change native-click admission or capture behavior.

## [2.34.0] - 2026-10-11

### Added

- Show Chromium’s initial and latest observed request priority in selected Network details, `browser_network_request`, and sanitized JSON copy. Missing observations stay unavailable; scheduling priority does not establish transfer order, server handling or an LCP cause.

### Fixed

- Retire pending Copy HAR results and feedback when clearing the Network list, so an older export cannot copy cleared records or restore obsolete success/error messages. Clipboard writes already dispatched are not undone.

- Count unmatched, unblocked key-down input during agent operations so native-click authority checks can stop later presses. Expected keyboard events are admitted once. Identical event shapes remain indistinguishable; event matching does not prove input origin. Concurrent mouse input retains its existing gap; use Pause agents for explicit takeover.

- Recheck MCP native-click authority before movements and presses across pause/access round-trips, cancellation, navigation/document commits, and compositor unlock. A successful press still receives its matching release. Earlier scroll, hover, or click effects are not rolled back; late invalidation reports `OUTCOME_UNKNOWN` with `retrySafe: false`, so inspect fresh state before retrying. This does not repair hit testing, establish semantic target identity after arbitrary DOM replacement, or guarantee delivery after a CDP transport failure.

- Clear Network content-search matches and errors when the query or Match case setting changes, and ignore replies from searches started before those edits. Submit Search to inspect the edited query.

### Known issues

- An intermittent native screenshot UnknownVizError remains unexplained. Controlled and original-order diagnostics did not reproduce it; no capture fix is claimed.
- Historical resize/evaluate stalls, destroyed-context and endpoint-startup failures remain unexplained; later passing checks do not establish their cause or a repair. Superseded-navigation ERR_ABORTED success-state behavior is also unresolved.

## [2.33.0] - 2026-10-10

### Added

- Inspect passive, value-free native form constraint flags with `browser_element_inspect`'s opt-in `includeValidity`. The validity data includes no field values or validation messages; collecting it invokes no validation UI and does not submit a form or establish submission acceptance.
- Record reviewed URL-path outcomes in Repro and export matching Playwright assertions. Matching compares the serialized pathname and ignores origin, query and fragment; it does not inspect page content or establish business success. Review pathnames before sharing because they may contain private data.

### Fixed

- Recheck agent authority and cancellation before committing MCP PDF exports and before publishing their results after audit settlement. Native rendering is not interrupted immediately. Pre-commit cleanup is best-effort; late rejection may retain an already committed PDF. Inspect the destination before retrying.
- A failed Network request-condition reorder no longer restores a condition removed while its native update was pending or overwrites newer condition-list edits.
- Preserve Network request-condition draft edits made while an earlier condition is being added, including edits during the following state refresh.

### Known issue

- An intermittent native screenshot UnknownVizError remains unexplained. Controlled and original-order diagnostics did not reproduce it; no capture fix is claimed.

## [2.32.0] - 2026-10-10

### Added

- Resolve an agent’s tab attention request explicitly from the tab context menu, and inspect or await that exact human resolution through the read-only `browser_user_attention` MCP tool. Notification acknowledgement remains separate from task completion.

- Search the Home tool reference using multiple words across each tool’s name, category and description.

### Fixed

- Wait for an unresponsive renderer to exit before loading its replacement, and keep later crashes, navigation and tab closure visible during recovery.

- Suppress obsolete MCP endpoint clipboard errors after a newer copy or endpoint change, while keeping current failures visible.
- Suppress obsolete diagnostic text-export clipboard errors after a newer copy, report refresh, recorder mutation or tab context change, while keeping current failures visible.
- Keep Site Storage clipboard errors scoped to the current report and clear copy feedback when the panel closes.
- Suppress obsolete Network request-detail clipboard failure toasts after selecting or refreshing a request, making a newer copy or resetting the tab context, while keeping current failures visible.

### Known issue

- An intermittent native screenshot UnknownVizError remains unexplained. Controlled and original-order diagnostics did not reproduce it; no capture fix is claimed.

### Notes

- Includes the improvements prepared for the unpublished 2.31.0 candidate.

## [2.31.0] - 2026-10-10

### Added

- Search the Home tool reference using multiple words across each tool’s name, category and description.

### Fixed

- Suppress obsolete MCP endpoint clipboard errors after a newer copy or endpoint change, while keeping current failures visible.
- Suppress obsolete diagnostic text-export clipboard errors after a newer copy, report refresh, recorder mutation or tab context change, while keeping current failures visible.
- Keep Site Storage clipboard errors scoped to the current report and clear copy feedback when the panel closes.
- Suppress obsolete Network request-detail clipboard failure toasts after selecting or refreshing a request, making a newer copy or resetting the tab context, while keeping current failures visible.

## [2.30.0] - 2026-10-10

### Added

- Search retained Console messages using multiple words across message text, source and stack frames, with every word matching the same entry.

### Fixed

- Suppress obsolete Console clipboard failure toasts after a newer copy, filtered-view change or tab context reset, while keeping current failures visible.

- Clear Network HAR copy feedback when export filters change, discard obsolete pending exports, and suppress late clipboard failure toasts after newer HAR actions.

- Keep saved-password list focus recovery from overriding another native window or a newer focus action while an account removal or inventory update completes.

- Restore “What's new” pagination focus after loading older releases or a failed request, including the final-page action, only while Hronaut is natively focused and without overriding newer focus or a closed dialog.

## [2.29.0] - 2026-10-10

### Added

- Filter loaded IndexedDB records using multiple words across keys, primary keys, value types and retained previews, without reading additional records or values.

### Fixed

- Restore Home copy-button labels while a new clipboard write is pending instead of leaving an earlier success or failure visible.

- Clear earlier MCP endpoint copy success while another clipboard write is pending or fails, preserving feedback only for the latest successful attempt.

- Label IndexedDB copying as “Copy filtered” when a record filter is active, so the button accurately describes the existing filtered-copy scope in every supported language.

- Clear IndexedDB copy feedback when the record filter changes, including clipboard operations that finish after a filter change.

## [2.28.0] - 2026-10-10

### Added

- Filter retained site-storage entries using multiple words across keys, value previews and cookie domains, without loading additional data.

- Search the current website’s account chooser using multiple words across account names and origins, with locale-aware matching and existing keyboard selection.

- Search saved passwords using multiple words across displayed account names and website origins, with matching and total counts.

### Fixed

- Keep keyboard focus while removing a saved password, then move to a neighboring password or the Saved passwords heading without overriding newer focus.

- Keep keyboard focus while clearing a website's history, then move to a neighboring retained website or the Global history heading without overriding newer focus.

## [2.27.0] - 2026-10-10

### Added

- Search visited websites in Workspaces & data using multiple words across each site's hostname, origin and retained title.

- Search saved site permissions using multiple words across each decision's origin, internal permission name and translated label.

- Search Downloads using multiple words across filenames and displayed origins, combined with status and filename sorting, without searching hidden URL details or saved paths.

- Search browsing history using multiple words across a saved title and address, combined with date, origin and visit-order filters.

- Search bookmarks using multiple words across a saved title and address, within the selected collection and sort order.

## [2.26.0] - 2026-10-09

### Added

- Search tabs using multiple words across titles, addresses, and workspace names, together with the existing result-type filter.

### Fixed

- Clear stale Visual Compare image-copy success feedback while another clipboard attempt is pending or refused.

- Give keyboard-reopened address suggestions a fresh session so delayed events from a closed popup cannot dismiss them or trigger stale navigation.

- Keep recently closed tab labels current while Tab Search stays open, and catch up when the overview regains focus.

- Clear stale diagnostic text-report copy feedback during another attempt and prevent older writes from restoring success while a newer copy is pending or refused.

## [2.25.0] - 2026-10-09

### Added

- Sort Downloads by filename in natural numeric order, combined with existing search and status filters, while retaining newest-first as the default.

- Copy a selected Network request’s displayed sanitized URL directly, preserving redaction markers without reacquiring details or replaying traffic.

### Fixed

- Clear stale Site Storage report copy-success indicators during another clipboard attempt, including refused writes, without changing report contents.

- Clear stale Console copy-success indicators when another clipboard attempt starts, including attempts that fail, while keeping late results from replacing newer feedback.

- Preserve the latest detached-panel request while the renderer loads its startup settings, so a newer panel does not revert to the window’s initial panel.

## [2.24.0] - 2026-10-09

### Added

- Search Downloads by the displayed HTTP(S) origin as well as filename, combined with the existing status filter, without searching hidden URL fields.

- Filter retained Network requests by HTTP status families such as `4xx` or `5xx`, including exclusions, consistently across the human panel, MCP and HAR exports.

- Refresh a selected Network request’s sanitized details after completion without replaying its traffic or changing the list filters.

- Reuse a recorded Repro step’s selector in the checkpoint form, with fresh review required before recording the intended result.

### Fixed

- Keep keyboard focus on Console’s pause/resume control while resumed updates are loading, without accepting duplicate toggles or stealing focus moved elsewhere.

## [2.23.0] - 2026-10-09

### Added

- Search saved site-permission decisions by site origin, permission name, or translated label, with visible/total counts and unchanged hidden decisions.

- Copy the displayed sanitized Network response body directly, retaining redaction and truncation markers without fetching or replaying the request.

- Identify HTTP(S) downloads by their retained download origin directly in the Downloads list, without displaying URL credentials, paths, query strings, or fragments.

### Fixed

- Keep keyboard position in Site permissions settings after forgetting a saved decision or receiving a live removal, with a neighboring control or the section heading as the fallback.

- Keep keyboard focus on Find’s Next/Previous match controls during asynchronous searches, while preventing unavailable or duplicate match requests.

### Documentation

- Clarify when a final Repro checkpoint replaces the exported assertion TODO, with a short workflow for turning an intended result into a regression test.

## [2.22.0] - 2026-10-09

### Added

- Copy a completed download’s saved path without opening its file or folder, with keyboard access and clipboard feedback that clears when the target or panel context changes.

- Pause displayed updates in the human Console while bounded log collection continues, with filters and copying on the displayed rows, one-shot refresh, and explicit unknown pending/missed counts.

- Filter the human Downloads list by Completed, Cancelled, or Interrupted alongside filename search. Interrupted includes both resumable and terminal interruptions, while existing Active and Finished filters keep their lifecycle meaning.

### Fixed

- Remove cleared Network requests from the displayed list immediately, including any request selected while Clear was pending.

- Keep keyboard focus in the bookmark collection filter when a live update removes the selected collection or its open editor, without overriding newer focus or a reopened panel.

## [2.21.0] - 2026-10-09

### Fixed

- Keep keyboard focus on the neighboring finished download after removing a record, including live updates that arrive before the action completes.

- Reject PDF exports when the source tab closes or navigates while printing or writing the file, including a navigation already pending when export starts. Keep tabs awake while a page capture or PDF is rendering.

- Remove a cancelled video export if its authorization changes while the output file is closing, while preserving an observed replacement file.

### Added

- Sort human browsing history by most visited within search, date and origin filters, with keyboard focus retained through live visit updates.

- Sort human Bookmarks by title within search and collections, while retaining the default recently updated order and keyboard focus through live renames.

- Filter Search tabs by open tabs, recently closed tabs, or archived workspaces while searching titles and addresses.

- Filter human browsing history by an exact HTTP(S) origin, together with title/address search and date filters.

- Remove an individual finished download from the human Downloads list while keeping its file and other transfers.

- Copy saved bookmark addresses without opening a tab, with keyboard access and feedback that clears when the panel context changes.

- Inspect bounded native audio/video element state with selector-only `browser_media_state`, including hidden audio (snapshot refs are explicitly unsupported), without exposing source URLs or changing playback, focus or tab lifecycle.

## [2.20.0] - 2026-10-08

### Added

- Add opt-in password-field occupancy to element inspection: report only empty/nonempty/unknown without exporting values or lengths, waking tabs, or changing selection.
- Copy a stored History address without leaving the current page, with accessible confirmation and retryable failure feedback.
- Open a History result in a background tab while keeping the current page, History panel, search and date filter.

### Fixed

- Preserve Downloads keyboard focus when a native pause/resume update arrives after its action reply.
- Reject stale element-inspection responses when workspace access, tab context or cancellation changes while audit results are being persisted.
- Preserve next-row keyboard focus when a bookmark removal publishes its live update before the removal request finishes.
- Keep Bookmarks keyboard focus reachable when an external bookmark or collection update removes the focused row, while preserving newer focus, search and collection selection.

## [2.19.0] - 2026-10-07

### Fixed

- Keep History keyboard focus reachable when a live date or history update removes the focused row, without overriding newer focus or a reopened panel.

### Added

- Filter browsing history by Today or Last 7 days in the computer's local calendar, together with title or address search.

- Organize saved bookmarks into single-level collections, with scoped search and collection removal that keeps every bookmark.

- Hide noisy Console messages with a literal text exclusion filter while preserving retained logs and unfiltered copying.

- Inspect opt-in physical scroll geometry for a selected element without scrolling it or invoking page-authored getters.

## [2.18.0] - 2026-10-07

### Added

- Open a saved bookmark in a background tab while keeping the current page, Bookmarks panel, search and keyboard focus.

- Save pages from browsing history to bookmarks without opening them. Existing bookmarks keep their saved name and dates.

- Filter the Downloads panel by filename and active or finished state, with visible/total counts, keyboard focus recovery, and explicit collection-wide finished cleanup.

- Edit a saved bookmark’s destination from the human Bookmarks panel while preserving its identity and title, with duplicate-address validation and keyboard focus recovery.

- Exclude matching requests with negative Network property filters such as `-domain:metrics.example` and `-url:poll`, consistently across the human panel, MCP, and sanitized HAR exports.

## [2.17.0] - 2026-10-06

### Fixed

- Keep keyboard focus on the current download control after pausing or resuming a transfer.

- Retire video previews when the recording or revision changes, including an externally re-rendered recording between polls, and discard stale preview downloads.

- Preserve keyboard focus when removing browsing-history entries, including the last visible search result and the final entry.

### Added

- Inspect stopped video recordings through MCP as bounded, numbered contact sheets of retained source frames, with explicit recording/revision binding, current origin access checks and sampling omissions.

- Omit one exact object property from a selected incident-package artifact using a reviewed literal path, while preserving other fields and array positions. Editing or rejecting a review retires its previous export approval.

## [2.16.0] - 2026-10-06

### Changed

- Update the bundled Electron runtime to 44.5.1 (Chromium 152.0.7977.130 and Node.js 24.21.0).

### Added

- Bounded same-origin iframe observations through `browser_snapshot frameSelector`, including headings, authored control labels/states and sanitized links while preserving parent context and references and reporting unsupported history and viewport omissions.

- Explicit per-tab ReactDOM 19.2.4 production topology inspection through `browser_react` and the native tab menu, with bounded observations, stale-ID rejection and no automatic reload or restart opt-in.

### Fixed

- Authorize retained worker lifecycle evidence against its captured origin before reading, stopping or clearing it, and recheck authority before returning asynchronous results.

- Update MCP SDK to 1.31.0 for upstream OAuth issuer binding; legacy stored credentials without an issuer still need migration when integrating OAuth clients.

- Reject Solana transaction counters that are truncated, exceed three bytes, or exceed the u16 range with Solana Kit 8.4.0.

- Form typing, selection and batch filling reject native disabled and applicable readonly controls, including state changes during focus, while preserving earlier successful batch writes.

- Update transitive proxy-addr and source-map-js dependencies for upstream IP trust and source-map denial-of-service advisories.

- Keep a final expected-result TODO in Repro exports when actions follow the last checkpoint, so an earlier passing check cannot silently stand in for a later outcome.

- Forked workspaces appear in the workspace tab bar as soon as Home can see them, while their stored data is still being copied.

- Removing a bookmark keeps keyboard focus on a neighboring removal control, the search field, or the panel close button when the collection is empty, without overriding a newer focus choice.

- Docked panels now save the final pointer release position when it differs from the last resize move, for both width and height adjustments.

- Bookmark renaming returns focus to search when the new title no longer matches the current filter, preserving keyboard access to the saved bookmark.

- Workspace-rail resizing now saves the pointer release position even when it differs from the last move event.

- Wallet workspace-scope choices now form native radio groups, so Tab leaves the group without stopping on its unchecked option; arrow-key selection remains available.

### Added

- Add reviewed Repro element-count checkpoints, including zero and hidden matches, with bounded structural selectors and Playwright count assertions.

- Observe bounded service-worker update history from MCP or Site storage → Offline, with version identities, explicit stop controls and retained interruption evidence. Observations always report incomplete history and never invoke worker lifecycle actions.
- Opt-in rendered-font inspection for ordinary leaf elements, with bounded font usage metadata and explicit exclusions for form controls, editors, containers and shadow content.

## [2.15.0] - 2026-10-04

### Added

- Opt-in viewport screenshot labels for selected semantic refs, with bounded image-space geometry and explicit changed, missing, offscreen and overlapping-target outcomes.

- Opt in to bounded CSS declaration candidates and generated stylesheet locations with `browser_element_inspect`’s `cssProperties` option. Computed-only inspection remains the default, and ambiguous cascade winners are not inferred.

- Show Web Vitals for the two latest browser-observed SPA routes in performance reports and Page tools, with distinct navigation identities, explicit collection coverage, and sanitized URLs. Document metrics and baseline comparisons keep their existing meaning.

### Fixed

- Reject Repro text checkpoints containing open shadow roots, preventing a recorded match from disagreeing with exported Playwright assertions while keeping shadow content outside recording scope.

- Show browser profile display names in the import picker, including Chromium account names and a Preferences fallback, while retaining directory disambiguation and safe fallback labels.

## [2.14.0] - 2026-10-04

### Added

- Explain observed LCP with bounded loading and rendering phases in performance reports and Page tools, explicitly marking missing timing evidence and unsupported navigation contexts.

### Fixed

- Repro text checkpoints exclude embedded script and style content, matching exported text assertions, and reject oversized observations with guidance to choose a smaller target.

- Reject performance measurements when the browser environment changes during collection, preserving existing baselines instead of labeling mixed observations with the final settings.

- Reject mixed checkbox/radio states in exported Repro expectations, matching the recorder's checked/unchecked contract.

- Highlight the Settings gear while its page is open so its active state remains visible after the pointer moves away.

## [2.13.6] - 2026-10-04

### Fixed

- Only reference the Settings panel from the gear when the panel exists, correcting the accessibility violation that blocked 2.13.5 publication. Includes the gear toggle and header search redesign from that unpublished candidate.

## [2.13.5] - 2026-10-04

### Changed

- Keep the Settings gear visible as an open/close toggle, remove the separate Settings rail entry, and replace the redundant page heading with section search beside Reset and Close.

### Fixed

- Preserve slow scrolling in Repro recordings by accumulating small movements before applying the scroll threshold.

## [2.13.4] - 2026-10-04

### Changed

- Deliver the redesigned Settings utility tab from the unpublished 2.13.3 candidate, with bottom-of-rail placement, the correct title, fewer duplicate controls, and readable content width.

### Fixed

- Verify the translated active Settings tab instead of the intentionally hidden duplicate gear button. This outdated localization assertion prevented 2.13.3 publication.

- Preserve small CLS changes in performance baseline comparisons so rounding does not hide layout-shift regressions.

## [2.13.3] - 2026-10-04

### Changed

- Place the Settings tab after workspace navigation, at the bottom of the vertical rail. Show the correct Settings title, remove duplicate active-page controls and the modal footer, keep Reset beside the page heading, and constrain settings content to a readable width.

### Fixed

- Ignore late Settings reset completions after the controller is disposed, preventing stale error notifications and new work during teardown.

## [2.13.2] - 2026-10-04

### Changed

- Deliver Settings as a reusable application tab beside Home, including the accessibility, keyboard focus, and responsive Wallets fixes from the unpublished 2.13.1 candidate.

### Fixed

- Use the immutable release commit timestamp for generated Linux update feeds and release history so publication retries retain the same checksums. Version 2.13.1 remains unpublished after its retry correctly rejected changed metadata.

- Retry transient GitHub release readback failures with bounded delays and report a privacy-safe failure cause, while retaining all draft and artifact verification checks.

## [2.13.1] - 2026-10-04

### Fixed

- Keep the Settings tab accessible, restore focus after closing What’s new, and fit Wallets forms beside the visible browser tab rail. Version 2.13.0 was not published because release integration checks found these regressions.

- Update integration coverage for Settings tab navigation and responsive chrome without weakening layout or accessibility assertions.

- Honor line and page mouse-wheel units when scrolling overflowing horizontal or vertical browser tabs.

## [2.13.0] - 2026-10-04

### Changed

- Open Settings in a reusable application tab beside Home. Switch between Settings and browser tabs, retain the selected settings section, and close the Settings tab without closing the underlying page.

### Fixed

- Preserve browser precision for CLS and individual layout-shift scores so small shifts remain visible and contribute accurately to diagnostic totals.

- Retry transient container-registry metadata failures before CI integration tests start, with at most two retries. Test failures still fail the gate immediately.

## [2.12.4] - 2026-10-03

### Changed

- Open Settings as a full-window page with its existing section navigation and independently scrolling content, giving controls the available screen space.

### Fixed

- Prevent delayed Settings permission lists from undoing newer displayed changes, removals, or resets.

- Generate full-window Settings screenshot baselines in the pinned Linux release environment to preserve consistent font rendering. Version 2.12.3 was not published because host-generated baselines differed from CI.

- Refresh Settings visual expectations for the full-window layout. Version 2.12.2 was not published because its old dialog snapshots failed validation.

- Match Repro text checkpoints consistently with exported Playwright assertions when result text contains zero-width spaces or soft hyphens.

- Require an existing target when replaying hidden Repro checkpoints, preventing missing result elements from silently passing as hidden.

- Honor line and page wheel units when scrolling the Settings section rail in narrow windows.

- Keep explicitly visible controls inside hidden containers reachable in modal keyboard wrapping, while excluding inherited hidden and collapsed controls.

## [2.12.1] - 2026-10-03

### Added

- Compare component-scoped snapshot baselines and deltas using the same private root selector, with explicit scope-change rejection and no whole-page fallback.

### Fixed

- Repair release validation after the switch to manual CI, retaining all release publication gates. Version 2.12.0 was not published.

- Preserve checked state alongside disabled state in page and component snapshots, so selected read-only checkboxes and radios remain distinguishable.

- Report native disabled state inherited from fieldsets in page and component snapshots, while preserving the first-legend exception.

- Keep modal keyboard wrapping on visible controls when disclosures are collapsed, while retaining access to their summaries and expanded contents.

- Publish license expiry promptly when a deadline passes during a state update, so the automation-lock notice does not wait for the next minute's refresh.

## [2.11.9] - 2026-10-03

### Fixed

- Reject semantic clicks on native-disabled controls using live page state, including disabled fieldset descendants, instead of reporting success when no click is dispatched.

- Measure semantic drag endpoints together after scrolling, so bringing the destination into view does not move the source away from the drag start.

- Preserve each workspace's remembered tab across restart so Home and agent commands without a tab ID return to the selected tab, while restoring the global active tab independently.

- Preserve native User-Agent Client Hints during locale-only emulation while still overriding browser language; explicit custom User-Agent behavior remains unchanged.

- Record Space activation on native buttons, submit/reset controls, and image buttons as a key action so Repro exports replay activation instead of trying to fill a non-editable control.

## [2.11.8] - 2026-10-02

### Fixed

- Require manual review of Repro actions whose target capture fails, including failures that settle before navigation, instead of silently omitting the action from exported tests.

- Keep an explicit manual-review step when navigation interrupts Repro click or keyboard capture, so a destination checkpoint cannot hide the missing action in an exported test.

- Replay redacted native-select type-ahead using explicitly supplied safe text and keyboard events instead of an invalid fill action; selected values remain unrecorded.

- Render supported primitive Console substitutions as readable plain text and omit CSS styling arguments, while preserving raw capture matching and redacting the assembled presentation.

- Record Space activation on native checkboxes and radio buttons as a key action so exported Repro tests replay it without trying to fill the control.

## [2.11.7] - 2026-10-02

### Fixed

- Preserve complete visual-comparison edge pixels when native zoom introduces floating-point rounding near integer bitmap boundaries, including 400% zoom.

### Added

- Expose recording-scoped video timing observations with source time, capture-attempt bounds and revision changes, while explicitly leaving pixel timing unknown.

- Compare an explicit viewport region with a retained visual baseline, cropped diff and clear coverage labels; reject incompatible region captures while preserving the whole-viewport default.

- Extend real page zoom through 400% in the toolbar, keyboard controls and MCP for reflow QA; existing zoom levels and reset remain available.
- Report point-in-time `focused` and `focusWithin` state in element inspection and copied element reports for keyboard and dialog-restoration checks, with explicit frame/shadow limits. Reject inspection results invalidated by navigation or observation-context changes.

## [2.11.6] - 2026-10-02

### Fixed

- Ignore hidden background CAPTCHA controls during observation-quality checks; add a persisted human-controlled “Detect visible challenges” setting, off by default, with the effective state in assessments. Other quality and permission checks remain active.

- Exclude editable drafts from Repro target labels and descriptions before they enter the timeline, MCP output or reviewed incident packages, while retaining public labels and structural selectors.

### Documentation

- Add an incident handoff checklist and companion-note example for reviewed setup, safe replacement inputs and bounded observation conditions.

## [2.11.4] - 2026-10-01

### Fixed

- Wrap incident-package JSON lines and long tokens in preview and offline exports without changing artifact text or hashes.

- Stop truncated Repro exports before replay so retained checkpoints cannot hide steps omitted at the recording limit.

- Fail a stalled Repro startup page read after five seconds, leave the recording inactive, and allow retry without accepting the late result.

- Keep page URL waits pending when only an iframe changes its route; match the main frame for both full-document and same-document navigation.

- Reset live screenshot and element-picker feedback when the current tab navigates or reloads, ignoring late results from the previous page while preserving frozen area selections.

## [2.11.3] - 2026-10-01

### Fixed

- Mark Network searches as bounded when request or response bodies, stream messages, or retained stream history were truncated, including searches with no matches.

- Stop generated Repro tests at unresolved manual steps instead of allowing another passing checkpoint to hide a skipped action.

- Clear MCP endpoint copy feedback when the address changes, so a newly configured endpoint is not shown as already copied.

- Show a pending state in Find in page instead of stale match counts, and disable match navigation until the current search completes.

- Preserve replacement CPU and code-coverage recordings when an older Clear operation finishes after debugger detachment.

## [2.11.2] - 2026-10-01

### Fixed

- Keep Network search snippets aligned with matching Unicode text instead of slicing at offsets shifted by lowercasing.

- Clear previous Network content-search matches when starting a new search, so pending or failed searches cannot display stale results.

- Recheck generated CSS locator uniqueness for deeply nested elements, reuse a unique supplied target when needed, and reject selectors that cannot be preserved within bounds.

- Keep generated Playwright locators in the inspected light DOM when open shadow roots could introduce additional matches.

- Keep editable values out of element inspection, live picker copies and generated locator names, while preserving public text and layout evidence.

## [2.11.1] - 2026-10-01

### Added

- Review up to ten ordered text replacements in incident packages, with bounded accessible rows, a scrollable review editor and explicit order before approving the exact export.

- Review up to ten exact field omissions in the incident-package editor, with bounded add/remove controls, keyboard focus and fresh approval after edits.

### Fixed

- Capture and search visible `display: contents` components without mistaking their boxless roots for hidden content; keep visibility checks bounded and explicit.

- Align Repro visibility checkpoint observations with rendered visibility, including suppressed content and bounded display-contents descendants.

- Clear rejected incident-package save previews and require fresh review on recovery, while preserving approval when the file dialog is cancelled.

## [2.11.0] - 2026-10-01

### Added

- Search a selected component with `browser_find.rootSelector`, preserving bounded snippets, scope metadata and existing privacy/workspace checks.

- Omit exact JSON field names from reviewed incident text artifacts before export, with bounded rules, omission counts and fresh preview approval.

### Fixed

- Distinguish failed find-in-page searches from zero matches and offer a retry that preserves the query.

- Reject stalled Repro checkpoint page reads after five seconds so Stop and retry can recover; ignore late results without recording an expectation.

- Clear stale incident-package previews and approval when a replacement capture or review fails; recovery requires reviewing the new package.

## [2.10.0] - 2026-10-01

### Added

- Add explicit checked/unchecked Repro checkpoints for native checkboxes and radios, exporting Playwright assertions without capturing form values.

- Record up to three independent tab videos while the human uses another tab, with fixed source/workspace authority, existing memory limits, and explicit pause behavior for unavailable rendering or suspend.

### Fixed

- Exclude nested rich-text editor values from semantic snapshots, search, deltas and WebMCP observations while retaining public text and authored control labels.

- Reject incident-package text replacements that merge JSON field names, preserving evidence instead of silently overwriting a field.

- Prevent global input unlock from waiting indefinitely behind an already-busy debugger queue. Failed preflight keeps locks unchanged and reports how to retry without applying a late unlock.

## [2.9.0] - 2026-10-01

### Added

- Add human-reviewed local incident HTML packages with bounded text evidence, artifact omission, exact-text replacement, frozen previews and integrity hashes.

- Add opt-in component-scoped MCP snapshots with unique CSS roots, explicit outside-scope omission and fresh capture identities.

- Add reviewed visibility and exact-text checkpoints to Repro recordings, with intended outcomes separate from observed matches and Playwright assertion exports.

### Fixed

- Restore arrow-key selection within workspace starting-data, site-access and data-transfer radio groups.

- Keep native disclosure controls in the modal keyboard focus loop, so wallet approval raw details can be reached and expanded before choosing an action.

## [2.8.8] - 2026-10-01

### Fixed

- Keep replacement element and area selections cancellable when an earlier selection’s page cleanup completes late.

- Release pending find-in-page requests immediately when superseded or cancelled, preventing accumulated listeners during rapid searches.

- Preserve a newer page navigation when it interrupts Memory Saver’s fallback wake, instead of incorrectly marking the live page as sleeping.

- Recheck agent licensing before delayed dispatch and show a non-modal expiry notice with license settings and purchase/renewal actions. Update elapsed expiry promptly while preserving manual controls, saved data, and existing trial/offline-grace terms.

- Keep audio composition controls within cue and imported-asset capacity, showing usage and preserving edits and removals when full.

- Flush the containing directory after replacing persisted state on supported POSIX filesystems, strengthening rename durability while preserving Windows, unsupported filesystems and writable directories without read permission.

### Changed

- Update Mediabunny to 1.60.0 and Viem to 2.56.9.

## [2.8.7] - 2026-09-30

### Added

- Compose complete browser clips with original music and sound effects, authorized WAV imports, timed volume/fades and Opus audio, camera zoom/pan and smooth cut transitions, with readable screen-anchored captions.

### Fixed

- Update TronWeb’s HTTP dependency to patched Axios while retaining the existing TronWeb API and production dependency audit gate.

- Settle canceled video exports immediately even when Electron leaves a destroyed export window’s page-load or encoder promise pending.

- Reject obsolete CPU and code-coverage start completions without clearing newer recordings or reloading a detached coverage tab.

- Reject obsolete CPU and code-coverage stop results after debugger detachment or tab replacement, preserving a newer recording instead of restoring or clearing stale profiling state.

- Bound agent-follow activity to the latest 40 dispatches so abandoned older calls cannot accumulate or select an obsolete tab after recent work finishes.

- Update build and lint brace parsers to patched versions that bound deeply nested glob expansion and address published recursion and rewrite advisories.

- Update transitive URI and IP parsers to patched versions addressing published host-normalization, cross-family subnet, and oversized-input advisories.

- Settle MCP activity history when saving a reviewed action outcome fails, preserving the reported storage error and allowing subsequent calls to be tracked.

- Flush persisted state file contents before replacing the prior file, preserving the prior state if the storage flush fails.

- Bound unfinished MCP activity metadata to the latest 40 dispatches so abandoned activities cannot accumulate throughout a long browser session.

## [2.8.6] - 2026-09-30

### Fixed

- Sign hex-looking Solana and Tron message strings as their UTF-8 text, preserving EVM hex decoding and explicit binary message inputs.

- Keep a live page selected when concurrent tab closing removes an already-destroyed active tab before its earlier close completes.

- Show capability-profile validation errors for argument constraint keys that collide with JavaScript prototype names, allowing the form to be corrected and resubmitted.

- Release workspace cookie listeners after the last tab closes, including when its native WebContents has already been destroyed.

- Cancel docked-panel resizing when the panel closes or Escape is pressed, releasing the pointer and restoring the prior size preference without saving a partial drag.

## [2.8.5] - 2026-09-30

### Fixed

- Restore workspace quick-setting checkboxes to their saved values after a rejected preference change, keeping open and archived cards accurate without rebuilding their controls.

- Suppress errors from obsolete workspace editor lookups after a newer action, dismissal, or competing modal takes over, while retaining current lookup failures and the newer browser import destination.

- Discard pending related network request selections when the panel context or selected request changes, preventing stale lookups and feedback in another tab.

- Give recorded arrows and callout pointers rounded chevron heads, a matching contrast outline, and proportional heads for short arrows and drawing entrances.

- Read navigation history through the retained tab handle so a native view being torn down cannot interrupt browser state snapshots.

- Keep older HAR export completions from overwriting a newer clipboard copy or replacing its feedback with stale errors.

- Track compressed response body bytes separately from decoded content bytes for accurate HAR sizes, without counting headers or sanitized text characters as body bytes.

- Export HAR request body sizes from byte metadata, marking unavailable sizes as unknown instead of reporting character counts as bytes.

- Copy HEAD requests with cURL header-only handling so valid responses do not hang or fail while waiting for a body.

- Report file-upload selector errors directly and release their debugger handles instead of attempting to upload into an exception object.

- Release remote debugger objects after script evaluation, including exception handles, so repeated failed evaluations do not retain extra references until navigation.

- Preserve explicit null results from background and dialog-handled JavaScript evaluation instead of changing them to undefined.

- Preserve thrown primitive values in console exception diagnostics instead of reporting only “Uncaught”, while retaining redaction and message limits.

- Serialize native tab and global input-lock changes through rollback so a failed request cannot undo a newer successful lock.

- Preserve regular-expression patterns and flags in IndexedDB previews, marking oversized patterns as truncated instead of displaying empty objects.

- Keep keyboard focus moving between available modal controls when a fieldset or explicitly focusable button is disabled.

- Show a waiting spinner while input-lock, mute, agent pause, or page lifecycle changes are queued or applying, and prevent duplicate clicks until they finish.

- Do not restore an outdated window focus owner when an agent action finishes after the human has moved away from Hronaut.

- Keep background tab replacement and page popups from requesting keyboard focus, and avoid raising an already visible window when an agent asks to show Hronaut.

- Read only the bounded set of object property values needed for IndexedDB previews, avoiding full-record entry allocation for large objects.

- Omit oversized IndexedDB field names with an explicit truncation marker instead of shortening them and overwriting another field in the preview.

- Distinguish NaN and positive/negative infinity from null in IndexedDB record previews, including nested arrays and floating-point typed arrays.

- Preserve complete empty storage values when diagnostic preview budgets are exhausted, instead of omitting them or marking them truncated.

- Patch vulnerable undici dependencies used by Electron downloads and native-build tooling, including preservation of custom connection policies.

- Preserve storage-change truncation markers when the snapshot preview budget omits a value completely.

## [2.8.4] - 2026-09-29

### Fixed

- Read individual local/session storage keys directly instead of enumerating every entry on large sites.

- Keep local/session storage results tied to the page where they ran, and reject operations if navigation changes the URL before execution.

- Report complete single-key storage lookups accurately even when the site has more than 200 entries; retain truncation flags for capped lists and values.

- Keep truncated storage previews out of the editor to prevent accidental replacement of complete values with partial text; explain how to enter a complete replacement.

- Allow reading, editing, and deleting valid empty or whitespace-only local/session storage keys through MCP and the Site storage editor.

- Preserve complete Unicode characters and byte limits in storage-change baselines and comparison values, sharing the storage preview decoder.

- Preserve complete Unicode characters in bounded storage previews and keep multilingual values within per-value and total byte limits.

- Keep cookie operations and their results scoped to the original page and browser session when the tab navigates during a storage request.

- Reject IndexedDB and storage-usage reports collected across page changes, including the StorageManager fallback, using a shared inspection guard.

- Reject offline-app inspections when the tab navigates or closes during collection, preventing reports that mix different pages.

- Mark Cache Storage listings as incomplete when oversized cache names are omitted, instead of reporting only the remaining caches as a complete list.

- Redact Cache Storage header values using complete header names before display limits, and preserve prototype-named headers as ordinary diagnostic data.

- Resolve offline-app manifest URLs before redaction and truncation, protecting credentials in long protocol-relative URLs and preserving the correct base directory for relative fields.

- Omit oversized page-metadata URLs explicitly instead of truncating credentials into misleading hostnames; keep relative links resolvable when the page URL is omitted.

- Redact credentials in long console and network source URLs before truncating their display, preventing partial credentials from surviving a cut-off URL authority.

- Avoid starting a stale memory measurement when allocation clearing finishes after switching tabs, reloading, or starting a newer diagnostic action.

- Keep CPU-profile and code-coverage Stop results and errors visible when a background recording-state refresh arrives before the action completes.

- Report offline-app diagnostic truncation accurately at the service-worker registration limit and when installability error arguments are omitted.

- Identify omitted repeated references in IndexedDB previews without incorrectly calling shared objects circular, and mark these previews as truncated.

- Limit IndexedDB Map and Set preview iteration to the displayed entries, avoiding a full temporary copy of large collections.

- Preserve prototype-named fields in IndexedDB record previews instead of silently omitting them.

- Report JSON-LD types independently for each metadata block, including types already present in other blocks or a full page summary.

- Associate Open Graph image dimensions and alt text with the correct image when pages declare multiple images with optional metadata.

- Avoid repeated full parameter rewrites when redacting duplicate secret fields in network URLs and form bodies.

- Preserve prototype-named JSON fields and headers in network diagnostics as ordinary data keys while retaining secret redaction.

- Omit deeply nested JSON network bodies when they cannot be safely redacted, preventing raw secret fields from appearing after a sanitizer failure.

- Show IndexedDB BigInt typed-array previews without dropping the enclosing record, and limit array conversion to the previewed elements.

- Preserve literal bracketed URL paths in copied cURL commands instead of rejecting them or expanding them into multiple requests.

- Prevent repeated wildcards in Network domain filters from freezing the interface or blocking network diagnostics.

- Keep Server-Timing diagnostics faithful to incomplete first parameters and preserve finite durations when rounding very large values.

- Preserve the last successful license validation when the service returns malformed or incomplete data instead of incorrectly marking the license inactive.

- Support arrow, Home, and End keys in the workspace color picker, with a single Tab stop and focus following the selected color.

- Make the search-engine radio group navigable with arrow, Home, and End keys, with one Tab stop and stable focus while saving.

- Release unused response streams when release-history requests fail, including rate limits that fall back to cached history.

## [2.8.3] - 2026-09-29

### Fixed

- Cancel pending Memory Saver sweeps when its settings change, so disabling it during a form-safety check cannot put a tab to sleep afterward.

- Clean up temporary MCP token files when startup persistence fails, preserving owner-only permissions and allowing a clean retry.

- Remove partial PDF, HAR, and video export files after a failed write, allowing retries to reuse the filename without overwriting existing files or deleting files that replaced a moved export.

- Close the hidden video export window and release its timeout and abort listener if renderer setup fails.

- Support Up and Down as well as Left and Right in the preview scale selector, moving keyboard focus and selection together without scrolling the page.

- Keep zoom controls usable after switching tabs while an earlier zoom request is pending, and prevent its late result from changing the new tab’s feedback or busy state.

- Keep superseded address-navigation errors from replacing or suppressing the latest error after an intervening navigation completes.

## [2.8.2] - 2026-09-29

### Fixed

- Preserve long download filenames when saving duplicates by making room for the numbered suffix without splitting Unicode characters or overwriting existing files.

- Keep PDF and HAR export filenames within filesystem byte limits for long non-ASCII page titles, preserving whole Unicode characters and room for duplicate-file suffixes.

- Keep an older Home copy failure from replacing shared feedback or selecting stale text after another copy action starts, and preserve selected text when status polling leaves its content unchanged.

- Correct the browser-mute documentation to explain temporary per-tab exceptions and when saved mute preferences are restored.

- Bound hostname title fallbacks so blank-title bookmarks and history entries on long hostnames survive restart.

- Allow address suggestions to retry after native popup setup fails, closing the failed popup instead of retaining an unusable cached load.

- Close workspace storage probes after setup failures and continue restoring cookies when a local-storage rollback probe cannot be created.

- Discard delayed reproduction scroll captures after navigation so input from the previous document cannot create a scroll step on the new page.

- Keep the MCP port field and confirmation aligned with newer settings events when an older port-change or reset response finishes.

- Preserve newer settings events when a delayed download-folder or download-preference response arrives, preventing stale responses from reverting other preferences.

- Update the rate limiter's transitive IP address dependency to 10.5.1, incorporating upstream IPv6 classification security fixes.

- Bound MCP JSON-RPC batches to 100 messages with the SDK 1.30.1 patch, preventing one HTTP request from dispatching an oversized batch.

- Preserve wallet request outcomes when late approval or signing attempts arrive after expiry instead of overwriting them as expired.

- Enforce managed-vault and watch-only wallet storage limits before saving, so adding wallets cannot create a file that fails to reopen.

- Reject allocation Stop results invalidated by tab changes or Clear while the final memory measurement is pending.

- Recheck tab context and profiler exclusivity after allocation sampling measurements, preventing stale or overlapping recording starts.

- Stop partially started coverage, CPU, and allocation instrumentation when setup fails, preserving rendering overlays and allowing a clean retry.

- Clear filtered-console copy feedback when the search or level filter changes, including delayed clipboard completions.

- Keep interrupted downloads cancellable and protected from history clearing until Electron reports completion, even when resuming is temporarily unavailable.

- Prevent pending console clipboard writes from restoring stale copy feedback after Clear.

- Remove stale video previews when polling observes that an agent edited or cleared the recording.

- Report workspace-opening failures from Settings through the standard error notification, and consistently wait for Settings to close before opening an editor.

- Keep one-time MCP credentials cleared when a pending create or rotate operation finishes after the credential panel closes or dismisses the secret.

- Keep completed MCP credential changes and newer profile refreshes authoritative over delayed profile-list responses, without duplicating newly created profiles already observed by a refresh.

- Verify the published Windows executable in release-triggered Scoop installation checks instead of rebuilding a different artifact.

- Prevent delayed clipboard writes from marking refreshed debug reports, quality audits, or inspector issues as copied.

## [2.8.1] - 2026-09-28

### Fixed

- Preserve successful wallet operation results when a follow-up refresh fails, so completed imports are not left awaiting confirmation with an already-consumed token.

- Preserve Settings search text and the selected section when an input method uses legacy composition key events.

- Discard delayed DOM recording export feedback after starting, stopping, or clearing its recording, using the same mutation guard as interaction recordings.

- Keep storage report copy feedback tied to the current report, discarding stale clipboard completions after refresh and disabling copy while reports reload.

- Keep notifications visible after keyboard focus enters them, including message replacements, until explicitly dismissed so their focused control does not disappear.

- Wait for committed input-method text before searching a page, avoiding repeated searches for an outdated query during composition.

- Preserve newer capture and cancel choices when an older capture-mode switch is still waiting for native picker cancellation.

- Keep pending HAR exports busy during Network refreshes, preventing duplicate save operations until the current export finishes.

- Keep the latest agent-status refresh authoritative when reopening its summary, so older responses or failures cannot suppress current connection evidence.

- Cancel pending capture-mode transitions when switching tabs or closing their controller, preventing capture from starting on an unintended page after native picker cancellation.

- Discard delayed recording export feedback after starting, stopping, or clearing the recorder, while preserving it during read-only refreshes.

- Discard pending Network details and copy feedback when the selected request is cleared or leaves the retained history.

- Wait for pending Console reads before polling again so slow responses remain visible instead of being repeatedly discarded.

- Resume live tab previews when a timed-out native capture later fails, while preventing overlapping captures.

- Keep wallet name and RPC edits open when Escape is used by an input method to cancel text composition.

- Preserve approved and in-progress human reviews at waiting-history capacity so their actions can retain outcome receipts.

- Prevent delayed release-history requests from replacing refreshed data or restoring invalidated older pages; use the latest valid cache for offline fallback.

- Preserve the highlighted address suggestion when live history updates reorder results, and clear it when its destination disappears or changes.

- Keep tab-overview preview captures paused during background navigation and hidden startup; refresh when the window becomes visible and focused again.

- Restore keyboard focus to the bookmark Rename button after saving or cancelling an edit, without interrupting focus moved elsewhere during a save.

- Recheck queued Developer Tools against completed input-lock changes and preserve shell panels when the tab is closed or locked.

### Changed

- Give independent tab controls separate buttons and consistent action labels: Pause/Resume agents, Lock/Unlock input, and Mute/Unmute.

## [2.8.0] - 2026-09-28

### Fixed

- Allow Developer Tools commands for a tab temporarily unlocked during global input lock, while respecting effective locks on protected pages.
- Keep rapid global and per-tab input-lock clicks ordered so a tab exception reflects the completed global lock.
- Preserve rapid Live/Frozen toggles by waiting for authoritative tab state between clicks; share tab-action queuing and cleanup with the separate agent control.

### Changed

- Add a separate per-tab agent pause/resume control with scoped exceptions to global pause; keep Live/Frozen page execution independent.
- Allow per-tab mute overrides while global mute is enabled; reapplying global mute resets exceptions and disabling it restores each tab’s saved mute preference.

## [2.7.4] - 2026-09-28

### Fixed

- Keep modified keyboard shortcuts and IME composition from switching Home workspace collections.
- Hide Home onboarding immediately when the first workspace is created or discovered by background refresh.
- Preserve keyboard focus on Home workspace controls and Preferences when background updates reorder cards.
- Restore Home tool-catalog order after clearing search or refreshing the catalog, preserving expanded cards and keyboard focus.
- Keep password CSV import reads bounded when files grow and reject named pipes without waiting for a writer.
- Prevent retrying a consumed browser-import preview after a failed write; use Back to choose a fresh preview.
- Enforce browser import byte limits for multibyte text and embedded NUL characters before loading cookie rows.
- Import usable Chromium cookies without requiring an OS key for partitioned, expired, or invalid encrypted cookies that are excluded from import.
- Enforce the browser import byte limit before reading malformed cookie rows with missing fields or oversized partition metadata.
- Avoid a false recovery warning when a destination cookie read fails before import writes anything.
- Skip destination storage verification when a browser import has no cookie writes, avoiding false recovery warnings.

## [2.7.3] - 2026-09-27

### Fixed

- Import browser sign-ins directly into active workspaces while keeping tabs and unsaved forms open. Workspaces with stored service workers no longer fail the archive-only import check, and a failed cookie no longer discards other successful imports.
- Keep bulk cookie imports responsive by batching workspace UI updates.
- Give the browser import site picker a larger, scrollable list and keep import controls visible on small windows and enlarged interface scales.
- Allow empty workspaces to be archived while preserving their browser data, including when page input is locked.

## [2.7.2] - 2026-09-27

### Added

- Import selected browser cookies into a specific workspace from the human-only workspace menu or Browser data controls. Linux Chrome/Chromium and Firefox profiles have a native read-consent prompt, searchable site selection, and verified writes into archived workspaces. Existing site data is preserved, agents stay paused, and browser profiles and cookie values are never exposed through the import API to MCP.
- Import encrypted Linux Chromium cookies through Secret Service with `libsecret-tools`. KWallet, macOS, and Windows browser import are not supported in this release.

### Fixed

- Continue video recording across same-origin navigation when Chromium temporarily cannot capture the loading page.
- Render Home status labels as text and escape other Home labels directly, including apostrophes in quoted attributes.

### Improved

- Style tutorial videos with readable caption/title/label presets, positioned text cards, numbered callouts, spotlights, curved arrows, and optional animation. Captions wrap at words, align consistently on the left, center or right, and support safe-margin anchors or exact normalized coordinates through both Page tools and `browser_video`.

## [2.6.0] - 2026-09-27

### Fixed

- Redact credentials and sensitive query values from download history before it reaches the UI or agent download tools.
- Keep Home workspace archive controls in sync when the global page-input lock changes.
- Let agents fork workspaces with stored service workers and duplicate cookie identities, including after a human renames the source workspace.
- Keep the human's selected tab visible when Follow agents is off, including agent tab creation, tab selection, and agent-triggered popups.
- Fix password observation for JavaScript-driven login buttons that live inside a form, so common SPA login patterns with `<button type="button">` are captured instead of relying on native form submission alone.

### Added

- Record a visible tab through Page tools or `browser_video`, pause/resume, add timed text, arrows, highlights and click markers, trim kept ranges, preview locally, and export WebM/VP9 tutorials without an external encoder. Recordings are silent, bounded and retained only while the tab remains open.

- Allow a temporary per-tab page-input unlock while the global input lock is on; the next global lock cycle restores the lock on every tab.

## [2.5.30] - 2026-09-26

### Fixed

- Discard page-metadata results after closing the panel, switching tabs, or reloading the document, including late responses in detached panels.
- Preserve Home setup input, focus, and copy feedback as the MCP listener finishes starting.
- Keep credential observation in an isolated JavaScript world so website hooks cannot intercept browser-owned account checks.
- Preserve account usernames through multi-step password capture, including two-step logins within one page.

### Changed

- Give page-metadata inspection its own runtime service and renderer feature, with a shared docked/detached panel and explicit request cleanup.
- Run Home interactions in a typed, isolated renderer with shared theme tokens, stable workspace controls during polling, and an inline first-connection journey.
- Open connection evidence from the MCP status control, with a separate Copy URL action and explicit Pause agents and page-input controls.
- Clarify that workspaces with direct agent access disabled still allow sign-in copying into a new workspace.
- Separate workspace archive/restore ownership and the Home protocol from the browser runtime and startup composition. Publish versioned public setup and tool metadata with tagged releases.

## [2.5.29] - 2026-09-25

### Fixed

- Preserve usernames through two-step logins within one page, so saved passwords for different accounts on the same website remain distinguishable. Recognize sectioned username fields and observe subsequent logins without requiring a reload.

## [2.5.28] - 2026-09-25

### Added

- Opt into MCP connections from other computers under Settings → MCP security. Remote access defaults off, applies after restart, and keeps local client setup working. Token authentication is optional and can be changed independently.

## [2.5.27] - 2026-09-25

### Fixed

- Start the MCPB adapter correctly when launched through a filesystem alias.
- Prevent concurrent update checks from scheduling duplicate restarts after a Linux package replacement.
- Keep iframe connection and certificate details out of the main document's security report.
- Keep recorded iframe and open-shadow interactions as manual steps instead of exporting selectors for their outer containers.
- Avoid overlapping native thumbnail captures when the overview opens after an earlier capture times out.

## [2.5.25] - 2026-09-24

### Fixed

- Handle deferred Home refresh failures without allowing an event-handler exception to interrupt the application.
- Keep exported reproduction targets scoped to the recorded document when pages contain shadow-DOM components.

- Preserve overlapping emulation changes and finish failed updates before applying newer settings.
- Generate complete MCPB metadata when the output directory is accessed through a filesystem alias.
- Defer automatic Home refreshes until an in-flight navigation finishes, and discard refreshes for closed or replaced pages.
- Reject queued page-lifecycle commands when their target document changes before dispatch.

## [2.5.23] - 2026-09-24

### Fixed

- Reject unsupported rendering-overlay names before applying emulation settings.
- Keep performance comparisons consistent when identical emulation settings are reapplied in a different order.

## [2.5.22] - 2026-09-24

### Fixed

- Keep reproduction selectors unique on deeply nested layouts and retain unresolvable actions as explicit manual export steps.
- Show the recovery message and retry action when the Home renderer crashes.
- Keep reported network wait durations accurate when the system clock changes.
- Keep reproduction step durations and typing groups stable when the system clock changes.

## [2.5.21] - 2026-09-24

### Fixed

- Wait for an already running scroll capture before stopping a reproduction recording, preserving its final scroll step.
- Keep DOM recording state current when delayed responses arrive after navigation, tab closure, clear, stop, or restart.
- Preserve newer DOM mutation counts when an older refresh response arrives late.

## [2.5.20] - 2026-09-24

### Fixed

- Keep delayed recorder stops tied to their original recording, and preserve the final scroll when Stop is requested concurrently.
- Preserve pending reproduction and DOM recorder actions, their busy state, and their errors during automatic refreshes.
- Keep the user's newer keyboard focus choice when delayed dialog-close cleanup finishes.
- Report download destination setup failures cleanly and release reserved filenames for later downloads.
- Reject malformed diagnostic actions and modes before they can change recording state.

## [2.5.19] - 2026-09-24

### Added

- Pause and resume downloads in the current session from the Downloads panel or workspace-scoped MCP controls.

### Fixed

- Preserve the `__proto__` mock response header when adding request conditions through the UI or MCP.

## [2.5.18] - 2026-09-24

### Fixed

- Reject delayed reproduction recording starts after a newer clear, stop, restart, navigation, or tab closure.
- Release native download listeners when their controller closes or a transfer finishes.
- Reject new website and agent wallet requests once application shutdown begins.
- Cancel waiting wallet approvals during shutdown and reject transaction preparation that finishes after shutdown.

## [2.5.17] - 2026-09-24

### Fixed

- Keep resumable interrupted downloads cancellable and retain them when clearing finished downloads.
- Remove embedded HTTP credentials from history and bookmark titles even when the title's URL exceeds the storage length limits.
- Do not count an iframe's in-page navigation as another visit to its parent website.
- Expire browsing-history visits during long-running sessions and reset repeat-visit counts after the 90-day retention window.

## [2.5.16] - 2026-09-24

### Fixed

- Show the exact fork action on metadata-only workspace entries so agents can copy workspaces with direct access disabled.
- Discard cached tab overview previews as soon as a tab goes to sleep.
- Hide the release history Load more action at the supported page limit instead of leading to an invalid page.
- Close stale site controls and page panels when same-document navigation keeps the website address unchanged.

## [2.5.15] - 2026-09-24

### Added

- Show archived workspaces as metadata-only fork sources in the agent's saved workspace list, even when direct agent access is disabled.

### Fixed

- Ignore delayed native address suggestions after another browser control closes the popup.

## [2.5.14] - 2026-09-24

### Fixed

- Keep browsing-history visit counts within JavaScript's safe integer range when restoring older data and recording another visit.
- Search invalid scheme-less IP addresses and ports instead of navigating to malformed URLs.

## [2.5.13] - 2026-09-23

### Fixed

- Remove partial HTTP credentials from older bookmark fallback titles even when their saved address was already sanitized.
- Restore the newest bookmarked page when saved duplicates or an oversized bookmark file are out of order.
- Keep bookmarks to different page sections visible as distinct address suggestions, including beside a visit to the same page.

## [2.5.12] - 2026-09-23

### Added

- Show workspaces with direct agent access disabled as metadata-only fork sources in the normal agent workspace list.

### Fixed

- Preserve visit totals when older browsing-history records resolve to the same page during restoration.
- Stop reading oversized live release history responses at the size limit and cancel responses that advertise an excessive `Content-Length`.
- Keep script and style text out of generated release notes when a longer closing tag name appears, and preserve safe text after Unicode characters.
- Keep a reopened address suggestion popup visible when a delayed dismissal from an earlier native popup arrives.
- Ignore delayed clicks from an earlier suggestion popup after the same visited page or bookmark appears again.

## [2.5.11] - 2026-09-23

### Fixed

- Reject bookmark addresses whose encoded URL exceeds the storage limit instead of saving a bookmark that disappears after restart, while allowing long discarded HTTP credentials when the safe address fits.
- Ignore delayed address suggestion selections after cancelling, dismissing, or reopening the suggestion popup.

## [2.5.10] - 2026-09-23

### Added

- Let agents provide a short system notification message when requesting human attention, and mark the requested tab with a visible, accessible attention badge until the request ends.

### Fixed

- Repair older browsing-history titles truncated inside HTTP credentials after their saved URL was sanitized, keeping those credentials out of address suggestions.
- Keep visits with long discarded HTTP credentials in browsing history when the sanitized address fits its storage limit.
- Repair older browsing-history titles that still contain a URL fragment even when the saved address is already clean, so private fragments do not reappear in address suggestions.

## [2.5.9] - 2026-09-23

### Fixed

- Keep matching visited pages ahead of bookmarks in address suggestions even when a bookmark hostname matches the typed text more closely.
- Record visited pages with long discarded URL fragments in browsing history, while keeping the stored URL within its length limit after encoding. Remove fragments from URL fallback titles, including those saved by older versions.

## [2.5.8] - 2026-09-23

### Fixed

- Restore saved bookmarks in actual time order when their timestamps use different timezone offsets, keeping address suggestions correctly ordered after restart.
- Remove embedded HTTP credentials from tab titles truncated from URL fallbacks when saving or restoring active and archived tabs.

## [2.5.7] - 2026-09-23

### Changed

- Show matching previously visited pages before saved bookmarks in address-bar suggestions while typing, with the existing history and bookmark filters still available.

### Fixed

- Restore browsing-history visits in their actual time order when saved timestamps use different timezone offsets, so address suggestions stay recent-first.
- Recognize Hronaut Home by its actual internal host across browser and shell controls so lookalike addresses cannot be routed to or hidden as Home.
- Use explicit page bounds for full-page screenshots so a minimized capture cannot silently return only the viewport.

## [2.5.6] - 2026-09-22

### Fixed

- Keep bookmark and history titles from splitting a Unicode character at their length limit, and repair titles previously stored with an incomplete trailing character.
- Restore address suggestions on fresh input after their renderer exits, including when the popup was hidden, without restarting the browser or losing the typed address.
- Apply the selected interface size when address suggestions first open, keeping their text and controls consistent with the address bar.

### Changed

- Include Electron page snapshots in failed integration-test traces, initialize capture after the shell is ready, retain evidence across manual app restarts, and bound trace export so diagnostics cannot prevent application cleanup.
- Run updater compatibility checks in one isolated helper process to reduce test startup overhead without relaxing assertions or time limits.

## [2.5.5] - 2026-09-22

### Changed

- Make the vertical tab rail wait for deliberate hovering before opening, allow a short grace period before closing, and reveal immediately for keyboard focus. Keep it steady during clicks and tab drags.
- Keep Home, the labeled pin control, workspace headings, and tabs at consistent vertical positions when the rail expands or collapses, with a denser header in short windows.

### Fixed

- Prevent a direct click on a collapsed tab from selecting a different tab as the rail opens.
- Keep the rail open while either the pointer or keyboard focus is still using it.
- Preserve a deliberately scrolled tab list when the rail changes width, while still revealing newly selected or keyboard-focused tabs.
- Reserve a complete neighboring tab row when scrolling a focused vertical tab into view, preserving three readable rows in small windows at enlarged interface scales.

## [2.5.4] - 2026-09-22

### Changed

- Split the broad MCP capability test into 13 independently initialized cases, preserving its assertions while improving failure isolation and parallel test scheduling.
- Separate coverage, CPU profiling, and memory diagnostics from the browser manager while preserving debugger ownership, recording limits, and navigation checks.

### Fixed

- Preserve typed address-bar drafts when focus moves to the page or other controls, and prevent an earlier navigation completion from erasing a newer draft. Escape still restores the current address.
- Show local address suggestions without waiting for animation frames in the hidden native popup, preventing matching history or bookmarks from remaining invisible when frame delivery is suspended.
- Prioritize matching website hostnames in local address suggestions so a visited site such as Google cannot be crowded out by bookmarks or other pages mentioning its name.
- Clear Find in Page matches when the active tab navigates or reloads, discard delayed results from the previous page, and retain the query for a fresh search when reopened.
- Release Find in Page listeners and its timeout immediately when Electron rejects starting a native search.
- Show EVM and TRON token `transferFrom` source accounts in approval details, and require manual review when the source differs from the selected signer.
- Treat only exact, canonically encoded TRC20 transfers, approvals, and delegated transfers as understood operations.
- Prevent delayed Repro timeline keyboard focus from overriding a newer pointer-selected step.
- Prevent delayed Site Controls, Command Palette, and bookmark-rename completions from reopening obsolete UI or stealing focus from newer actions.
- Separate Solana legacy-provider routing from Wallet Standard payloads so website-supplied fields cannot change standard response shapes.
- Preflight every Solana batch transaction and message signer before creating approvals, preventing later invalid inputs from following earlier signing side effects.
- Route full-page captures through a temporary rendering host whenever the main window is minimized, even if the platform still reports it as visible.
- Require Solana Wallet Standard sign-and-send requests to declare the active wallet chain before transaction normalization or approval.
- Preserve wallet policy usage counters when encrypted policy removal cannot be saved, keep policy attachment changes transactional, and reject moving an existing policy identity between wallets.
- Bound wallet policy amounts and accumulated spend before arbitrary-size decimal arithmetic can stall the main process.
- Show Hronaut after a minimized sign-in launch when the system tray cannot be created, avoiding an inaccessible hidden process.
- Stop reporting a drifted Linux autostart entry as enabled when its `TryExec` points at a different application.
- Preserve empty binary fields while serializing wallet requests instead of rejecting their canonical empty base64 representation.
- Open scheme-less loopback development URLs containing a query or fragment over HTTP instead of treating them as a custom scheme or web search.
- Preserve explicit custom-protocol addresses whose payload contains a dotted name instead of rewriting them as HTTPS URLs.

## [2.5.3] - 2026-09-22

### Fixed

- Keep bounded website tab titles well-formed when the length limit lands inside a Unicode surrogate pair.
- Emit the legacy Solana `accountChanged` event with current PublicKey-compatible state so direct provider integrations cannot retain a stale account after connection or permission loss.
- Guarantee caller-initiated Solana disconnects emit `accountChanged(null)` even when their response arrives before the provider lifecycle events, without duplicating the notification when those events follow.
- Return usable copied bytes for serialized legacy Solana transaction inputs and reject malformed batch-signing responses instead of exposing invalid or proxy-wrapped typed arrays.
- Match EIP-1193 event delivery semantics for callback receivers and validation, including when wallet listeners add, remove, or register the same callback more than once during provider events.
- Keep Solana and TRON dapps bound to their previously authorized account and network even when another attached wallet sorts ahead of it, and expose only TRON's active account when other wallets are also permitted.
- Provide both Base58 and standard `41…` hex forms for the connected TRON account through the injected `tronWeb.defaultAddress` compatibility surface.
- Add configured custom Solana networks to the Wallet Standard chain metadata before exposing their accounts, preserving the required account-to-wallet chain relationship for adapters.
- Reconcile active website wallet sessions when their account permission expires, so stale EVM accounts are removed and Solana/TRON providers disconnect without waiting for another wallet mutation.
- Saturate browser-reported storage byte counts before aggregation so malformed or extreme quota data cannot leak `Infinity` or unsafe integers into Site Storage reports.
- Omit impossible completion-derived network phases and saturate extreme timing and response-byte values so out-of-order or malformed Chromium events cannot appear as valid zero-duration evidence, render as zero bytes, or expose non-finite diagnostics.
- Keep macOS startup visible when the native login-item service cannot report whether Hronaut was opened at sign-in, instead of aborting application startup.
- Reset launch-at-sign-in and minimized-launch preferences with the rest of Appearance, including removal and transactional rollback of an active packaged startup registration.
- Make Solana provider disconnects revoke the actually permitted account before session tracking and remain idempotent after every Solana wallet is removed.

## [2.5.2] - 2026-09-21

### Fixed

- Prevent delayed semantic snapshot and memory measurements from restoring or advancing obsolete baselines, and reject memory results captured across navigation.
- Keep delayed accessibility and performance baseline measurements from recreating or overwriting state after a newer clear or replacement request, and reject performance results captured across navigation.
- Keep delayed Site Storage baseline and comparison snapshots from overwriting a newer clear or request.
- Keep a delayed visual-comparison capture from recreating or overwriting state after a newer clear, baseline, or comparison request.
- Prevent delayed Repro recorder page measurements from leaking across a clear, stop, restart, or later page navigation into the wrong timeline context.
- Stop reporting malformed Linux autostart files as enabled when they omit the required application type or name.
- Advertise the injected wallet icon as a base64 image data URI so strict Solana Wallet Standard clients accept Hronaut discovery metadata.
- Treat `about:blank`, `view-source:`, and `blob:` schemes case-insensitively when enforcing restricted workspace navigation policies.

## [2.5.1] - 2026-09-21

### Changed

- Run renderer unit tests in a memory-bounded VM worker pool, preserving per-file isolation while substantially reducing repeated jsdom startup time.

### Fixed

- Avoid recording unchanged or cross-document scroll positions after reproduction-timeline clicks, removing timing-dependent phantom steps.
- Align the injected Tron provider with TIP-1193 by using official hexadecimal chain IDs, typed provider errors and disconnect payloads, ordered account state updates, and connect events.
- Disconnect active Solana and Tron provider sessions immediately when their account permission or backing wallet is removed, preventing dApps from retaining stale connected state.
- Reject an explicitly empty `HRONAUT_MCP_TOKEN` in both the desktop runtime and packaged MCPB adapter instead of silently generating a different profile token or starting an unauthenticated adapter.
- Notify Solana Wallet Standard apps when an account's chain, signing features, public key, or display metadata changes without an address change, and return a numeric EIP-1193 error for malformed request arguments.
- Explicitly terminate packaged MCP smoke-test sessions before closing their local clients so workspace write leases are released immediately during Scoop reinstall verification.
- Terminate MCPB adapter and native-dialog QA sessions before closing their HTTP transports so host disconnects release workspace write leases immediately.
- Treat Linux autostart entries with duplicate keys or repeated Desktop Entry groups as invalid instead of reporting an ambiguous launch-at-sign-in registration as enabled.
- Restore the previous runtime setting after a partially failed apply and retain both persistence and rollback failures when a transactional setting change cannot recover cleanly.

## [2.5.0] - 2026-09-21

### Added

- Add reusable browser-task definitions with redacted runtime inputs, pre-execution previews, explicit capabilities and human gates, read-only-only retry limits, exact tab/origin/control-generation bindings, typed drift outcomes, and privacy-safe task receipts.
- Add process-local, transport-bound workspace write leases with privacy-safe ownership inspection, explicit handoff, deterministic `BUSY`/`LEASE_LOST` outcomes, pause and disconnect revocation, and two-client regression coverage.
- Include privacy-safe write-lease mode, holder state, expiry, and current-owner generation in version 4 action audit receipts so handoffs and reconnects are reviewable without exposing foreign generations or MCP transport identities.
- Add a native MCP-to-WebMCP consumer bridge for QA and Complete profiles, with top-level-only discovery, bounded untrusted metadata and results, origin/navigation/runtime-bound descriptor digests, stale-tool rejection, typed unknown outcomes, and fresh page evidence after calls.
- Add an explicit external-wallet and mobile dApp QA boundary matrix with a safe local-provider handoff recipe, stage-based evidence, and negative controls that avoid credentials, funded accounts, production dApps, and compatibility overclaims.
- Add a deterministic watch-only public-address QA recipe that verifies scoped balance observation and below-UI signing rejection without importing recovery material, using real funds, or implying WalletConnect support.

### Fixed

- Bound WebMCP tool enumeration by the same operation deadline as execution and report synchronous page-callback failures as possibly effectful dispatches instead of claiming that nothing ran.
- Preserve authored reference files when rebuilding the documentation website while still removing stale generated HTML and asset bundles.
- Return the EIP-1193 disconnected error when no EVM wallet is available, keep Solana Wallet Standard account data immutable to untrusted pages, and avoid advertising signing features on watch-only Solana accounts.

## [2.4.31] - 2026-09-20

### Added

- Add privacy-bounded public-outcome receipts that compare an exact writer-context target with a distinct clean read-only observer workspace and distinguish independently visible, absent, unknown, and stale or contradictory results without enabling blind retry.

### Fixed

- Advertise Solana Wallet Standard transaction-version support so standard adapters can initialize reliably, reject non-canonical EVM chain-switch requests, and return interoperable provider errors for unsupported methods and unconfigured chains.

## [2.4.30] - 2026-09-20

### Added

- Add explicit per-tab page freeze/resume controls for deterministic QA, with observable unknown outcomes, preserved animation rates, a trusted-shell indicator, a narrowly scoped MCP tool, and a measured Electron 44 / Chromium 152 support contract.

### Fixed

- Complete EIP-1193 connect/disconnect notifications, reconcile account approval across every live same-origin provider session, and keep Solana Wallet Standard account-change events synchronized with fully resolved account state.
- Generate valid freedesktop autostart entries for unusual Linux executable paths and recognize valid registrations that use whitespace around desktop-entry separators.

## [2.4.29] - 2026-09-20

### Added

- Add cross-platform options to launch Hronaut at sign-in and keep automatic launches minimized in the system tray.
- Publish the verified official MCP Registry identity in the canonical public facts and explain that its MCPB adapter still requires a locally running Hronaut desktop app.

### Fixed

- Avoid treating a commented or unrelated Linux desktop-entry command as an active Hronaut sign-in registration.
- Derive the MCP Registry public-readback URL from the verified release metadata so identity drift cannot break an otherwise valid publication.
- Bound wallet-agent session expiry by monotonic elapsed time so an operating-system clock correction cannot extend authorization beyond its intended lifetime.

## [2.4.28] - 2026-09-20

### Added

- Publish verified MCPB release metadata to the official MCP Registry only after the GitHub release, checksums, provenance, and public website readback succeed.
- Document client network topology and loopback reachability across native, WSL, container, VM, Remote SSH, and cloud runtimes, with copy-safe failure reasons and a same-host health-to-browser preflight.

### Fixed

- Preserve task-run history and heartbeat deadlines across system-clock corrections without weakening monotonic expiry checks.
- Keep human-approval receipt timelines ordered across system-clock corrections and reject an invalid clock before changing a live review.
- Hold the Electron 44.4.x line after both released patches shifted trusted controls during compact Home navigation.

## [2.4.27] - 2026-09-19

### Fixed

- Let the release publisher find authenticated draft releases during asset reconciliation instead of stopping on GitHub's public-only tag lookup.
- Hold Electron 44.4.1 after Docker QA exposed a renderer crash and compact-navigation layout regression.
- Keep Dependabot's Playwright queue limit on its multi-ecosystem group so GitHub accepts the configuration.
- Keep Settings navigation icons out of Vue's deep reactivity path, removing avoidable render overhead and repeated development warnings.

## [2.4.26] - 2026-09-19

### Fixed

- Recover release publication safely from partial or ambiguous GitHub asset uploads by preserving verified files, bounding transient retries, and reconciling every checksum before making the draft public.
- Route MCPB users to its specific setup guide and let protected profiles pass the owner-only token file to the local adapter without exposing the raw token in Home or bundle configuration.

## [2.4.25] - 2026-09-17

### Fixed

- Preserve readable regular-file permissions when standard Linux ZIP tools extract the MCPB adapter.

## [2.4.24] - 2026-09-17

### Changed

- Correlate local wallet QA attempts across provider selection, JavaScript invocation, rejection, and independent receipt reads while keeping accounts, hashes, signing payloads, raw receipts, provider messages, and RPC URLs out of the fixture log.

## [2.4.23] - 2026-09-17

### Added

- Add copy-safe MCP readiness diagnostics to Home and the authenticated health response, separating listener health, client initialization, advertised tools, active-client visibility, and benign read-only probe evidence.

### Changed

- Make active agent work easier to notice with a faster, brighter, thicker pulse around the whole tab in horizontal, vertical, pinned, and collapsed layouts.

## [2.4.22] - 2026-09-17

### Added

- Add clean, origin-scoped `public-observer` workspaces that block page mutation tools for independent logged-out checks.
- Add an opt-in observation-quality assessment to `browser_snapshot` that stops on empty shells, login walls, human-verification challenges, soft 404s, wrong origins, missing task evidence, and structurally noisy pages before agents reason from misleading content.

### Changed

- Publish a reproducible local EVM wallet QA quickstart and clarify that the local-wallet preview has been available since Hronaut 2.4.21.
- Make agent activity easier to spot with a softly blinking outline that follows the tab shape, including pinned tabs and the collapsed sidebar, without taking space from the title. Keep the signal steady with reduced motion and describe it to screen readers.

### Fixed

- Avoid treating a meaningful article as an automated challenge solely because its title contains challenge-like wording.
- Repair clock-skewed saved-credential timestamps and keep a future-dated stale duplicate from replacing the current password.

## [2.4.21] - 2026-09-16

### Changed

- Generate bounded release-history notes in linear time so validation and release preparation stay responsive with large multibyte changelogs.
- Split hosted Electron integration coverage across five isolated runners to shorten pull-request and release feedback while retaining the complete suite.

### Fixed

- Repair malformed, future, and inverted workspace timestamps so damaged profiles or clock changes cannot keep stale workspaces incorrectly ordered on Home.
- Repair future and inverted bookmark timestamps so clock skew cannot keep stale pages permanently ahead of genuine address-bar suggestions.
- Persist repaired active and archived tab titles so oversized or control-character page metadata cannot remain in the local profile after recovery.
- Persist sanitized workspace origin metadata and malformed workspace description repairs so private URL details and invalid context cannot remain in the local profile after recovery.
- Keep Memory Saver tabs recoverable when a failed sleep transition cannot restore the page or a wake aborts before replacement navigation, instead of leaving an internal sleeping page marked awake.
- Move native focus into trusted browser chrome when Ctrl/Cmd+L is pressed from a website so typing reaches the address bar.
- Clear failed renderer-recovery markers and restore the visible page problem when Electron cannot start an unresponsive-page reload.
- Verify workspace cookie rollback and restore overwritten destination cookies even when Electron silently ignores an expiration write.
- Retry Linux page-visibility recovery when a renderer probe stalls instead of leaving that page permanently excluded from repair checks.
- Ignore native view teardown races during Linux page-visibility recovery so a destroyed view cannot stop later repair checks.
- Remove malformed HTML delimiters from published release-history notes so nested markup cannot survive the plain-text boundary.
- Fail URL waits promptly when the website renderer becomes unavailable.
- Keep partitioned cookies isolated during workspace data copies instead of widening them into unpartitioned destination cookies.
- Warn when a workspace data transfer omits partitioned cookies that Electron cannot recreate safely instead of reporting a complete transfer.

## [2.4.20] - 2026-09-16

### Fixed

- Preserve cookie and local storage changes made by destination pages while a failed workspace data copy rolls back.
- Keep page readiness waits pending when an embedded frame fails while the main document is still loading.
- Fail page readiness waits promptly when the website renderer becomes unavailable.
- Clear a previous page's favicon when a tab navigates to another page on the same website without a valid icon.
- Clear a previous page's favicon when navigation to a different main document fails.

## [2.4.19] - 2026-09-16

### Changed

- Split hosted Electron integration coverage across four isolated runners to shorten pull-request and release feedback as the suite grows.
- Show the bound browser-session generation during consequential action review and require a separate trusted confirmation that the signed-in account and visible target were verified before approving tab-bound browser actions.

### Fixed

- Repair future-dated browsing-history visits caused by clock skew so they cannot remain ahead of genuine recent visits indefinitely.

## [2.4.18] - 2026-09-16

### Fixed

- Invalidate pending browser approvals when a saved-password fill changes the username or account state but the page disables or replaces the password field before the fill can finish.

## [2.4.17] - 2026-09-16

### Fixed

- Re-read consequential-action review authority immediately before and after durable dispatch admission, closing a race where a login-session change during asynchronous validation could leave a stale approval usable.

## [2.4.16] - 2026-09-16

### Fixed

- Invalidate pending consequential browser-action reviews when an isolated workspace's cookies change, preventing an approval from surviving a silent login-session rotation or revocation.

## [2.4.15] - 2026-09-15

### Fixed

- Invalidate pending consequential browser-action reviews after a person fills a saved password, so a review cannot survive an account or login-authority change.

## [2.4.14] - 2026-09-15

### Fixed

- Preserve structured stale-observation details when a tab closes during MCP wait dispatch, including the narrow gap before the wait handler starts.

## [2.4.13] - 2026-09-15

### Fixed

- Keep Home dashboard refresh scheduling deterministic across window teardown, preventing delayed polling work from outliving its page lifecycle.

## [2.4.12] - 2026-09-15

### Fixed

- Let saved-password filling follow a newly selected or reloaded page immediately without waiting for a stale fill request, while suppressing feedback from the superseded page.

## [2.4.11] - 2026-09-15

### Fixed

- Apply a server-wide MCP tool-set change before its persisted setting becomes visible, preventing a newly connecting client from briefly receiving the previous catalog.
- Expire unattempted consequential-action reviews when their MCP session reconnects, while blocking new mutations behind an unresolved attempted review.

## [2.4.10] - 2026-09-15

### Added

- Add one versioned support, recovery, and exit guide covering supported setups, workspace backup and reset boundaries, client reconnection checks, local data recovery, and product scope.
- Compare accessibility audits against a volatile per-tab baseline, with explicit new, remaining, and resolved rule/target findings in Page tools and MCP responses.
- Review recorded reproduction steps through a keyboard-navigable timeline with a focused action, target, page, and relative-time detail view.

### Fixed

- Persist a human-decision expiry before returning it when the deadline passes during a status read, preventing restart from briefly restoring an already expired decision.
- Invalidate existing full-access MCP sessions and pending browser dispatches when the authentication mode or token changes, so approvals cannot survive credential rotation.
- Keep workspace descriptions available from workspace-header hover text without permanently taking space in the tab navigation.
- Reject accessibility and quality-audit results when their tab navigates before collection finishes, preventing stale findings from being reported for a newer page.

## [2.4.9] - 2026-09-15

### Fixed

- Align workspace name and description fields with the app's form design, keep description help below the input, and improve editor spacing and scrolling in narrow windows and at larger interface sizes.
- Show workspace descriptions beneath their names in the left navigation panel, with compact two-line previews and the full description on hover.
- Keep address-history suggestions aligned with final client-rendered page titles without counting title changes as extra visits.
- Resume live tab previews after a timed-out native capture eventually settles, without allowing unresolved captures to accumulate.
- Make workspace colors easier to distinguish in dark themes with persistent color markers, stronger container tinting and borders, and larger indicators.

## [2.4.8] - 2026-09-14

### Fixed

- Keep tab close controls available while website input is locked, including for unavailable pages being reloaded by an agent.

## [2.4.7] - 2026-09-14

### Fixed

- Load advertised favicon candidates concurrently so a stalled icon URL cannot leave a valid website icon waiting behind repeated network timeouts.

### Added

- Add provider-neutral browser reconciliation that classifies authoritative visible records before writes, binds stable item/target/source fingerprints, blocks changed or ambiguous preconditions, skips already-satisfied clicks, and preserves independent post-write verification.
- Add bounded approval groups for two to four exact, ordered browser clicks, with per-step postconditions, fresh continuation revisions, drift invalidation, and explicit review of the whole sequence.
- Add durable workspace descriptions so people and agents can record and recover each workspace's purpose, current work, and stored browser context.
- Add a runnable Docker reference for externally scheduled browser tasks, including explicit ownership, stable trigger/session identities, cancellation before dispatch, and reconciliation-safe retry rules.

## [2.4.6] - 2026-09-14

### Fixed

- Align MCPB release metadata with Hronaut's current Subscription and Trial License instead of the superseded PolyForm identifier.

### Documentation

- Add reviewed local-only directory metadata, a schema-valid Glama maintainer file, and an owner workflow for correcting misleading hosted-deployment instructions.

## [2.4.5] - 2026-09-14

### Added

- Add bounded semantic snapshot baselines and deltas for repeated agent inspection, with explicit unchanged results, complete change counts, output truncation, and stable invalidation reasons across navigation, tab, format, and workspace-control drift.
- Add an opt-in Docker browser-evaluation runner with pinned local failure scenarios and a deterministic privacy-safe evidence report.

### Changed

- Speed up repeated focused Docker integration tests by reusing content-verified Electron build output when its inputs are unchanged.
- Fan release Electron integration tests across three isolated hosted runners, preserving full coverage while reducing the release gate from one sequential suite to three concurrent partitions.

### Fixed

- Run cross-platform package candidates for actual `release/` pull requests without triggering them for unrelated branch names that happen to contain `release-`.

## [2.4.4] - 2026-09-14

### Added

- Publish a version-matched, informational operator manifest with each release so agent clients can discover supported tool sets, local prerequisites, authority boundaries, result states, and independent read-back requirements.

### Changed

- Run four local Docker integration shards by default to reduce CPU contention and avoid slower, flaky renderer startup on six-CPU Docker hosts.

### Fixed

- Verify network timing sort order without assuming a fixed-delay request must remain the slowest under heavy host load.

## [2.4.3] - 2026-09-14

### Added

- Add privacy-safe review metrics to bounded task runs, including interruptions, approvals, rejections, decision time, system-caught errors, completed tasks, and ambiguous outcomes.

### Fixed

- Move native focus from the website to the Find field when `Ctrl/Cmd+F` opens Find in page, so immediate typing enters the query.

## [2.4.1] - 2026-09-13

### Changed

- Show the bound authority generation in consequential action reviews so people can distinguish approvals created under different MCP sessions.
- Place access, workspace assignment, and automation controls in each wallet's details instead of a separate wallet settings tab.
- Keep the Wallets heading visible together with its sticky tab bar while scrolling long wallet settings.

### Fixed

- Persist website favicons even when their fetch finishes after the navigation state save, so delayed icons survive crashes and forced restarts.
- Reject a saved-password fill when that credential is updated, removed, or cleared while its secret is being decrypted.

## [2.4.0] - 2026-09-13

### Added

- Add a trusted Home action to clear an open workspace, including its tabs and isolated website data, even when website input is locked.
- Add a compact Match case option to Find in page and keep Ctrl/Cmd+F focused on the selected search text.
- Add reviewable consequential browser handoffs with privacy-safe exact-action hashes, visible workspace and capability context, cheap reject and cancel controls, single-use approval bindings, drift and reconnect invalidation, and durable attempted, verified, and unknown receipts.
- Let capability profiles restrict exact tool argument paths for tabs, wallets, recipients, targets, and payloads while persisting only canonical value hashes; delegated children can only narrow inherited constraints.

### Changed

- Organize Web3 wallet settings into Your wallets, Add wallet, Access & automation, and Activity tabs, with a selectable wallet list, focused onboarding, and explicit empty states in all seven interface languages.

### Fixed

- Restore authenticated website favicons with workspace cookies, retain them across reloads and app restarts, and recover history suggestions after their native popup is recreated.
- Coalesce repeated website wallet-connection calls into one approval so checkout flows do not fail while the first request is still active.

## [2.3.1] - 2026-09-13

### Fixed

- Show history and bookmark address suggestions reliably when typing while the suggestion popup starts.
- Display website SVG and ICO favicons across platforms, and keep tab icons when embedded frames load or navigate.
- Keep Home content width and alignment stable when switching between tabs with and without a vertical scrollbar.

## [2.3.0] - 2026-09-13

### Changed

- Home is now the workspace hub, with searchable Open and Archived views, creation, settings, templates, archive undo, and restoration. Removed the separate Workspaces button from navigation; Home returns directly to workspace management.
- Added options to hide individual workspaces from the left sidebar and protect them from permanent deletion by people or agents. Hidden workspaces remain accessible from Home; archiving, restoration, and restart retain both choices.
- Browser mute can be enabled before any website tabs exist. It persists across restart, applies to future tabs, and preserves individual tab mute preferences when switched off.
- Kept agent connection setup, activity, and the tool catalog accessible from Home, with workspace controls translated into all seven supported languages.

## [2.2.0] - 2026-09-13

### Added

- Open the new Workspaces library directly from the browser sidebar or top bar. Search workspace names and page titles, see the current workspace and access settings, and switch between Open and Archived collections.
- Open, manage, archive, restore, and delete workspaces with visible controls. Undo a workspace archive immediately; archived tabs and sign-ins stay available for later.

### Changed

- Simplify workspace creation with compact color choices and side-by-side choices for a fresh profile or copied sign-ins. Keep website restrictions, data transfers, and continuity reviews in clearly labeled expandable sections.
- Keep library search and creation controls visible while scrolling. Adapt the workspace library and editor to small windows, light and dark themes, and all seven interface languages.

## [2.1.3] - 2026-09-13

### Fixed

- Align the workspace-header divider with the navigation and Home header dividers. Keep the same border placement, thickness, and color at every interface scale.

## [2.1.2] - 2026-09-12

### Fixed

- Restore consistent buttons in What's new, Help, workspace editing, and wallet approval. Give release notes clearer headings, full-sized retry and pagination actions, readable download tables, and accessible warning colors.
- Keep docked tool headers, close buttons, and footer actions reachable in narrow panels. Reflow Network filters, Site Storage categories and editors, and tool summary cards to fit the available space.
- Improve dark-mode contrast for active page actions, storage actions, update and download indicators, and browser-tool warning and error feedback.

## [2.1.1] - 2026-09-12

### Changed

- Keep Commands, Tabs, Downloads, History, input blocking, mute all tabs, and agent following in one row of named utility icons. Place Settings directly after MCP status and retain access to every utility in narrow and short workspace rails. Give utilities their own row in smaller top-tab windows so workspace tabs remain usable.
- Use consistent button sizes, borders, icons, keyboard focus, and primary or destructive states throughout Settings, including workspace data, MCP credentials, downloads, wallets, and updates.

### Fixed

- Open the workspace editor reliably when Create workspace is selected in Settings.

## [2.1.0] - 2026-09-12

### Added

- Mute or unmute the current page directly beside the tab input lock in the navigation bar, including silent tabs. The control follows the active tab and reflects mute changes from other controls.

### Changed

- Redesign the desktop window around persistent workspaces: new profiles start with the resizable left tab rail, labeled everyday actions, and explicit new-tab actions within workspaces. Saved tab-layout choices remain available and unchanged.
- Refresh light and dark surfaces across the shell, native title bar, tabs, address bar, dialogs, and developer tools with calmer colors, clearer selection, and lighter overlays.
- Make Settings easier to navigate with a compact section list and localized search. Select a result with Enter, clear a search with Escape, and find sections by their descriptions.
- Rebuild Home into dedicated Connect an agent, Overview, and Tool library views, with a remembered selection and keyboard navigation. Keep setup and verification together; give live clients, session metrics, and recent activity their own overview; provide a searchable tool catalog with expandable descriptions.

## [2.0.0] - 2026-09-12

### Breaking changes

- Remove legacy persisted-data support: discard old base-profile browser data, active and archived workspaces without isolated storage, and tab snapshots older than version 3. Current isolated workspaces retain their identities and storage.
- Delete version-0 and version-1 wallet vaults, their pending requests, and obsolete plaintext authority files without migration. Version-2 encrypted wallets remain supported.
- Remove `fork-default`, `import-default`, `save-default`, Default-profile workspace fields, and old transfer payloads. Use `fork-workspace` with an explicit source, and human workspace-to-workspace Copy or Move controls.
- Replace legacy data management with global history clearing and workspace-scoped site storage. Ignore obsolete update settings and use Browser Essentials when no tool set is saved.

### Added

- Explain capability rejections with a bounded, privacy-safe precedence trace and stable first-denying-rule reason, keep permission separate from dispatch and postcondition state, and require every non-read MCP tool to declare its operation class explicitly.

- Distinguish successful, failed, cancelled, blocked, interrupted, verifier-rejected, timed-out, and unknown agent outcomes in the activity dashboard and task-run summaries, with privacy-safe reason provenance, dispatch state, and conservative effect certainty.

## [1.28.0] - 2026-09-12

### Added

- Allow trusted Settings to derive a narrower MCP capability credential from an active parent, with persistent parent/revision lineage, shared use limits, and immediate descendant invalidation when ancestor authority changes.
- Record bounded root-to-leaf capability profile lineage in action audit decisions without retaining bearer credentials, credential identifiers, private scope values, or tool arguments.

### Fixed

- Publish the trial and subscription distinction consistently in landing-page metadata, visible pricing FAQ content, and machine-readable product data so directories cannot infer an ongoing free plan.
- Preserve parent authorization when a derived MCP capability is edited so an update cannot silently turn it into an independent root credential.

## [1.27.0] - 2026-09-11

### Added

- Add named MCP capability profiles with one-time credential display, digest-only storage, tool and action restrictions, workspace and origin scopes, expiry and use limits, immediate revocation, and trusted Settings controls.

### Changed

- Clarify Hronaut's boundary as a local, visible MCP execution layer alongside agent frameworks in the landing page and quick start, with current trial and subscription terms.
- Add an explicit native mode for agent element clicks so custom controls can receive trusted pointer and mouse events while the virtual agent pointer remains visible.

### Fixed

- Correct the Hronaut initial in the static landing-page header mark and keep anchored section headings below its sticky navigation.
- Ignore Electron child views whose native `webContents` getter is invalidated during teardown so the Linux page-presentation recovery timer cannot raise an uncaught main-process exception.

## [1.26.1] - 2026-09-11

### Added

- Show a temporary virtual pointer for agent clicks, hovers, and drags so people can follow MCP-controlled interactions without moving the operating-system cursor.

### Fixed

- Return a stable stale-observation result when a tab closes during an MCP wait, including the brief interval before Chromium finishes removing the tab from workspace state.

## [1.26.0] - 2026-09-11

### Changed

- Replace the broad Privacy & data Settings panel with workspace-first management that lists active and archived profiles, opens per-workspace controls, and exposes the existing selective copy or archive-only move workflow; application-wide history and legacy Default-profile cleanup remain in a clearly scoped secondary section.

### Added

- Add a registry-ready MCPB adapter that connects stdio clients to the running desktop application's loopback Streamable HTTP endpoint, preserves JSON-RPC messages and session isolation, rejects remote destinations and redirects, and keeps optional bearer tokens in sensitive local configuration.

## [1.25.0] - 2026-09-11

### Added

- Extend opt-in action audit receipts with bounded diagnostic, network, DOM-change, storage-change, reproduction, and postcondition coverage metadata; available artifacts use opaque run-scoped references that reject changed control or navigation generations without copying report contents into the journal.

### Fixed

- Include the canonical public license and trial facts in clean Docker validation so release checks exercise the same tracked facts as local validation.
- Expire live audit evidence references across application restarts and report whether missing evidence came from capacity, observation, or persistence failure.

## [1.24.0] - 2026-09-11

### Security

- Bind consequential browser actions to trusted runtime origin, navigation, workspace, permission, policy, human-interaction, observation, and target facts, rejecting stale or replaced pages before dispatch with explicit retry guidance.
- Record bounded provenance rejections in private audit receipts without retaining selectors, refs, scripts, page text, entered values, credentials, paths, or raw origins.

### Documentation

- Explain why page content is untrusted input, how browser action authority is derived, and why workspace site-access policy does not provide network isolation.

## [1.23.0] - 2026-09-10

### Added

- Add a versioned canonical public-facts file, publishing checklist, and copy validator to keep pricing, licensing, platform, setup, and supported-client claims synchronized.
- Add `browser_task_runs` for durable, bounded workflow deadlines and heartbeats, with runtime-checked page, origin, and audit evidence before success and explicit blocked, timed-out, restart, or unknown outcomes.
- Let `browser_click` opt into bounded post-write verification with delayed read-back, explicit account and state predicates, durable receipt events, and conservative unknown outcomes without replaying the click.
- Add a global tab-audio control that mutes or unmutes every open website tab while preserving the existing per-tab speaker, context-menu, keyboard, and `browser_audio` controls.

### Fixed

- Pin the complete MCP tool catalog and server instructions for each live connection, so a Settings change applies only after reconnect and cannot silently alter model-facing metadata mid-session.
- Fence retained Console, Network, and in-progress download evidence by an opaque observation generation that advances on pause, reconnect, and workspace resume, preventing delayed requests, redirects, and downloads from becoming actionable after a handoff while recording the boundary in tab state and audit receipts.

## [1.22.0] - 2026-09-09

### Added

- Durable workspace human-decision records with responsible and fallback owners, bounded deadlines and notification attempts, reconnect discovery, and trusted local review controls. Acknowledgement does not resolve an unknown action outcome, replay work, or unpause agents.

### Fixed

- Keep the temporary PDF print host hidden so exporting from a tray-hidden browser does not interrupt foreground focus on Wayland.

## [1.21.0] - 2026-09-09

### Added

- Add explicit agent workspace continuity checkpoints and fresh review after pause, reconnect, or restart, with localized workspace-editor controls, continuity reports on guarded workspace resume, guarded dispatch, and separate reporting for stale observations and unknown prior outcomes.

### Changed

- Clarify full and partial refund effects on access and renewals, and default support-assisted cancellations to the end of the paid period.

### Fixed

- Avoid duplicate suggested workspace names when adding template entries after removing or renaming entries.

## [1.20.0] - 2026-09-09

### Added

- Preview, edit, import, and export portable workspace setup templates with fresh isolated profiles, explicit review, collision checks, and partial-failure cleanup. Browser sign-ins and credentials are excluded.

### Fixed

- Report retained workspace identity and cleanup guidance when initial tab creation and workspace cleanup both fail.

### Documentation

- Clarify browser versus native desktop testing scope and distinguish browser approval from downstream authorization, with disposable-fixture and synthetic policy examples.

## [1.19.1] - 2026-09-09

### Fixed

- Update Electron to 44.3.0 with upstream crash, permission-handling, and Linux sandbox tray fixes.

- Recover visible Linux pages whose compositor stops presenting frames without requiring a window resize.
- Invalidate delayed MCP results after direct human keyboard or mouse input in the target page, without requiring a pause.
- Capture background tabs outside the viewport of the existing visible browser window, avoiding a temporary window that can interrupt foreground focus on Wayland.

### Documentation

- Explain when a dedicated persistent browser profile is sufficient and when Hronaut workspaces help, with first-run persistence and visible-handoff checks.

## [1.19.0] - 2026-09-09

### Changed

- Require a paid subscription for all ongoing use after a 10-day trial starting with the first agent tool call. Enforce expiry before agent tools run, preserve manual data recovery, and limit offline paid access to seven days since validation.
- Align licensing and pricing at $4/month or $24/year per user (the annual price already includes 50% off $48), with three devices per seat. Earlier releases retain their original terms.

### Security

- Update js-yaml and Hono to patched versions identified by the production dependency audit.

## [1.18.0] - 2026-09-09

### Fixed

- Preserve uncertain write and stale observation outcomes in audit receipts after a human-agent handoff.

- Preserve bounded MCP activity history and metrics across endpoint replacement, including commands that finish after their client disconnects.

### Added

- Include active command counts and explicit unknown prior outcomes in paused MCP responses, including after client disconnects.

## [1.17.0] - 2026-09-08

### Added

- Show the number of MCP commands still settling during a pause, with guidance to inspect fresh page state before resuming.

### Fixed

- Discard workspace tool results when pause or ownership changes invalidate them while the handler runs, reporting stale observations or unknown write outcomes without returning the obsolete result.

## [1.16.0] - 2026-09-08

### Added

- Report structured snapshot completeness and search-source limits, and use measured truncation for clipboard copies, while preserving snapshot text, redaction, and workspace isolation.

### Fixed

- Recheck pause state, workspace access, and target membership after asynchronous audit admission and tab wake so stale requests cannot dispatch after control or ownership changes.

## [1.15.0] - 2026-09-08

### Added

- Add `browser_preflight` to the QA and Complete MCP tool sets for bounded workspace, origin, site-policy, and human-attention readiness checks, with explicit unverified session evidence and no automatic retries.

### Fixed

- Keep credential filling and browsing-data cleanup blocked while an MCP command is still running after its client disconnects or the endpoint is replaced.
- Suppress credential-fill success and error notifications from the previous document after a same-URL reload.

## [1.14.0] - 2026-09-08

### Added

- Opt-in workspace action audit receipts using `browser_audit_receipts` in the QA and Complete MCP tool sets, with bounded private journals, correlated site decisions, explicit partial outcomes, and sanitized JSON reports that survive reconnects.

### Fixed

- Clear stale diagnostics after same-URL reloads and prevent new DOM reads from reusing requests for the previous document, while preserving active recorders and baselines.

## [1.13.2] - 2026-09-08

### Fixed

- Ignore snapshot and PDF export feedback from a previous document after reloading the same URL, and allow a new export immediately without waiting for the older request.

## [1.13.1] - 2026-09-08

### Added

- Fork any active or archived workspace into an independent profile with copied cookies and local storage and a blank tab. Agents can discover fork sources without receiving access to the original tabs.
- Allow users to disable direct agent access per workspace while still permitting forks. The choice survives archiving and restart and blocks existing agent ownership and resume keys.
- Copy browser data between selected workspaces, or Move between archived workspaces after verifying the destination. Move checks for live pages and background site workers before starting and reports any incomplete cleanup without removing the verified destination copy.

### Changed

- Start on Home without automatically creating Default. Existing Default profiles retain their data and can be renamed, archived, restored, or deleted. Deleting the last workspace returns to Home.
- Clarify workspace creation and data transfer with explicit source, destination, data types, and Copy/Move controls.

### Fixed

- Prevent agent site-data cleanup from racing workspace copies, archiving, or deletion. Conflicting operations report that the workspace is busy before modifying data.
- Keep archived workspace metadata recoverable if creating its replacement Home view fails.
- Bound hidden storage-view initialization and scripts so a stalled renderer cannot hang a workspace transfer indefinitely.

## [1.12.3] - 2026-09-07

### Fixed

- Recover Linux pages whose native view is visible but Chromium remains hidden after presentation changes in Electron 44, without reloading the page or stealing focus.

## [1.12.2] - 2026-09-07

### Fixed

- Preserve website viewports while Settings and other full-screen dialogs are open, and restore page geometry before revealing content. This prevents one-pixel page layouts and addresses a cause of blank content requiring a window resize, including in split view.

## [1.12.0] - 2026-09-07

### Changed

- Upgrade the browser runtime to Electron 44.2.0. macOS builds now require macOS 13 Ventura or later on both Apple Silicon and Intel.

### Fixed

- Restore the browser on Linux tray left-click, including desktops where activation does not display a menu. Right-click still opens tray actions.
- Keep the selected tab visible after a resize when an older tab retains DOM focus or the browser window is unfocused.
- Prevent macOS updates from offering the new runtime to systems older than macOS 13.
- Keep active tabs clear of the trailing scroll control in narrow horizontal workspace strips while preserving separation from their sticky workspace label.
- Preserve verified text and image copying with Electron 44’s asynchronous system clipboard API, including failure reporting and recovery after rejected writes.

## [1.11.59] - 2026-09-06

### Added

- Resize split panes by dragging their divider, with keyboard adjustment and an equal-size reset. Canceled gestures restore the previous size; committed sizes survive restarts.

### Fixed

- Preserve the completed split resize when another drag starts before its acknowledgement, including cancellation of the next drag.
- Keep split pages usable when opening docked Page tools by closing the competing Split view menu.

## [1.11.57] - 2026-09-06

### Fixed

- Keep revealed workspace controls above the page in narrow windows by reserving their actual width, with a readable address row and correctly anchored suggestions.
- Keep Split view menus inside short windows, with scrollable candidates and reachable Close and Exit controls.
- Finish toolbar clicks before collapsing a focused workspace rail, so moving focus cannot shift the clicked control before mouse release.

## [1.11.56] - 2026-09-05

### Improved

- Add a quick collapse animation to the unpinned workspace panel, respecting reduced motion and keeping manual resizing immediate.

### Fixed

- Keep inactive page tools neutral so only enabled tools and capture feedback use status colors.
- Use the normal cursor over tabs, a pointer over Close, and a dragging cursor only during an actual drag.
- Show the canonical Hronaut app icon beside its title-bar name instead of a generic dashboard grid.
- Keep Settings and workspace Create/Edit dialogs open when clicking their backdrop, so outside clicks and text-selection drags do not discard unfinished workspace drafts.

## [1.11.55] - 2026-09-05

### Fixed

- Keep the Home label visible in expanded vertical rails and preserve keyboard focus when the pointer leaves the rail.
- Open detached Page Tools without a false startup failure from primary-window wallet initialization.
- Keep the software-update loading indicator visible during checks, downloads, and installation across themes.

### Improved

- Resize the workspace panel by dragging its page boundary or using the keyboard. Remember the preferred width across restarts while preserving room for the page in smaller windows.
- Suggest playful, editable names for new human-created workspaces, avoiding open and archived workspace names.
- Keep workspace names visible while scrolling vertical tabs and recover tab-list space with a compact Home/pin row and paired scroll controls. In short windows, reach tab search, history, and downloads through Commands while Settings, input lock, agent follow, and server status remain visible.
- Include bounded recent published release history in checksummed and attested release assets so the website can recover when the GitHub API is unavailable.

## [1.11.54] - 2026-09-05

### Fixed

- Keep the keyboard-focused tab or workspace control visible when the tab rail expands or resizes.
- Keep workspace tabs and page actions visible at larger interface sizes in narrow windows.
- Preserve the full selected element or rectangle in screenshots at non-default page zoom, and honor image size limits on high-DPI displays and emulated viewports.
- Detect version bumps across the complete Git push so a later commit in the same push cannot silently skip the release.
- Keep Settings actions visible in short windows at larger interface sizes, and give narrow forms enough room for their explanations and controls.

### Improved

- Add Cyberpunk Turbo with readable off-white text, selective cyan accents, magenta controls, yellow highlights, and matching Home and address suggestions.
- Sharpen the enlarged single-tab overview preview while keeping normal thumbnails compact and retaining the existing image-size limit for visually complex pages.
- Group tabs inside their workspace with a New tab action after the last tab, persistent workspace names during horizontal scrolling, and clear selection in horizontal and vertical layouts.
- Bring Home setup into view sooner with compact live status and endpoint controls, clearer client instructions, and secondary connection verification and first-task sections.
- Simplify Settings and Page Tools with quieter navigation, readable rows, and clearer actions.

## [1.11.51] - 2026-09-05

### Fixed

- Preserve the complete viewport in tab thumbnails and keep overview navigation controls at the bottom of the window.
- Keep keyboard tab activation disabled while another overview action is pending.
- Keep selected segmented controls readable when hovered.
- Preserve keyboard focus when navigation replaces a full-page preview or retry message.
- Include every page edge in bounded full-page screenshots at non-default zoom.
- Capture awake background tabs without selecting them, handle very long pages at the preview size limit, and discard captures made stale by a viewport change.
- Show unavailable status on Home when local status requests fail, and restore the current MCP status automatically after a successful refresh.
- Restore the standard button size and styling for clearing an empty Page tools search.
- Show visible, accessible retry feedback when Home cannot open an agent guide, troubleshooting, or setup feedback.

### Improved

- Inspect a tab's full page from the overview with Fit page, Fit width, refresh, and an explicit Open tab action, while preserving the live tab's viewport, scroll, and selection.
- Give small tab collections larger, centered previews and keep larger collections searchable in a stable layout.
- Guide Home setup through connecting an agent, verifying observed activity, and trying a first task, with searchable client guides, remembered guide selection, and collapsible setup and tool reference sections.

## [1.11.50] - 2026-09-04

### Fixed

- Preserve the newly selected page when a delayed tab-close request finishes or is canceled by unsaved-change protection.
- Keep newly selected network requests visible when older replays finish, and discard stale replay or content-search feedback after selection changes or clearing the log.
- Honor page beforeunload protection for human tab-close actions with a trusted, cancel-safe confirmation while keeping agent closes non-blocking.
- Redact token-like query values from IndexedDB, storage-change, cookie, code-coverage, CPU-profile, and memory diagnostic report URLs.

### Improved

- Find Page tools by name, task, or category with keyboard-friendly search, readable descriptions, and cards that adapt to the available panel width.
- Keep the public setup directory, reference, and setup-feedback client list aligned with every built-in coding-agent guide.

## [1.11.49] - 2026-09-04

### Fixed

- Keep Memory Saver from unloading unsaved drafts in valid `contenteditable` modes such as plaintext-only editing regions.
- Fill saved passwords only into visible login fields and keep username selection inside the password field's form.
- Open uppercase, mixed-case, and trailing-dot `localhost` development addresses over HTTP when their scheme is omitted.
- Rate-limit repeated failed local MCP authentication attempts without throttling authenticated agents.
- Encode dynamic page-script values defensively across credential filling, text waits, and reproduction exports.

### Improved

- Keep native interaction-lock rollback verification deterministic when page lifecycle synchronization is queued, preserving the strict no-flake release gate.

## [1.11.47] - 2026-09-04

### Improved

- Migrate the complete renderer and address-overlay styling surface to Tailwind CSS 4 composition, expose the existing theme tokens as semantic utilities, and enable the same pipeline in Storybook without applying global Preflight to Electron controls.

## [1.11.46] - 2026-09-04

### Added

- Expand the renderer UI library with semantic inputs, textareas, selects, checkboxes, switches, dialogs, menus, popovers, tabs, segmented controls, toggle buttons, tooltips, spinners, and empty states, including keyboard and accessibility contracts in Storybook and component tests.

### Improved

- Replace the temporary native button compatibility mode with an explicit application appearance, so every renderer action receives shared button state and focus behavior while established compact controls retain their intentional dimensions.
- Automatically connect shared form controls to field labels, validation messages, hints, required state, and disabled state, and adopt the form contracts in commercial-license and core settings panels.

## [1.11.45] - 2026-09-04

### Added

- Add a renderer UI component library with shared buttons, icon buttons, fields, notices, and settings rows, backed by Storybook theme/a11y coverage, CSS-token validation, and light/dark visual regression tests.
- Add first-class Zoo Code setup to Hronaut Home with global Streamable HTTP configuration, conservative approval defaults, and environment-backed authentication that keeps the owner token out of JSON.
- Add first-class Goose setup to Hronaut Home with persistent Streamable HTTP configuration, cross-platform config locations, and environment-backed authentication that keeps the owner token out of YAML.

### Improved

- Route every renderer action button through the shared UI component boundary while retaining the established behavior and styling of specialized browser controls.
- Organize the commercial-license settings slice by feature and enforce layered renderer CSS tokens with Stylelint.

## [1.11.44] - 2026-09-04

### Fixed

- Keep **Follow agents** from switching tabs while the user is editing the address bar, preserving the draft and resuming passive following after keyboard focus leaves the field.

## [1.11.43] - 2026-09-04

### Fixed

- Make **Follow agents** reveal freshly created background tabs even when their short MCP activity starts and finishes back-to-back, without waking completed sleeping-tab work or taking input focus.
- Return promptly when a workspace site-access policy blocks a redirect instead of occasionally leaving the navigation request waiting indefinitely under load.
- Refresh the packaging-only XML parser to its patched MIT-licensed release, removing the known fragment-injection advisory from the release toolchain.

### Improved

- Show **Following agents** with an explicit stop action while the mode is active, so its current state and next click are clear without relying on color alone.

## [1.11.42] - 2026-09-03

### Fixed

- Roll back in-memory wallet request creation, transitions, approvals, and cancellations when their durable atomic write fails, preventing ghost requests or unpersisted signing authority from surviving in the live process.
- Contain and visibly report wallet-request cancellation persistence failures during navigation, tab closure, and workspace closure instead of leaking an unhandled main-process rejection.
- Keep disabled or temporarily deferred **Follow agents** activity from redundantly waking sleeping tabs; the MCP operation remains the sole owner of its required page wake-up.
- Preserve every rapid **Follow agents** toggle while earlier settings writes are still pending, so a quick on-then-off gesture cannot leave following enabled.

## [1.11.41] - 2026-09-03

### Added

- Add first-class Qwen Code setup to Hronaut Home with safe authenticated and authentication-disabled HTTP MCP configurations.
- Add an independent, persisted **Follow agents** mode that passively shows the tab an agent is using, defers behind trusted Hronaut dialogs, and never takes keyboard or mouse focus.

### Fixed

- Keep local Solana and TRON transaction policies behind human approval until their RPC networks can be independently authenticated.
- Restrict public wallet approvals to requests that have reached the human-review state.
- Match Solana and TRON policy destinations case-sensitively while preserving normalized EVM address matching.
- Cancel pending wallet requests when signing keys are locked, and invalidate an in-flight signature before it can be returned or broadcast.
- Reject lossy wallet-provider payload types instead of allowing serialization to silently change an approved request.
- Focus the selected website after direct tab or Mission Control selection so immediate keyboard input reaches the page, while locked tabs keep focus in trusted chrome and agent-created tabs never steal native window focus.

## [1.11.40] - 2026-09-03

### Fixed

- Dismiss website-owned JavaScript dialogs whenever trusted Hronaut chrome covers the page, preventing a hidden site from blocking or imitating wallet approvals and other modal decisions.

### Improved

- Move active-tab cleanup and detached-panel presentation ownership out of `App.vue` into the focused active-tab feature controller.

## [1.11.39] - 2026-09-03

### Added

- Add first-class Grok Build setup to Hronaut Home, using its native local HTTP MCP transport with authentication referenced through the environment instead of copied into configuration.

### Fixed

- Ignore a delayed native address-suggestion click after the user switches tabs, preventing the stale result from navigating the newly active page and discarding its state.
- Bootstrap a live Mission Control preview when the active page's first screenshot finishes after the overview opens, without waking sleeping or never-presented background tabs.

### Improved

- Keep the authoritative sharded Docker suite deterministic under CPU contention by allowing first-instance shutdown startup enough time while still detecting an accidentally launched persistent app.

## [1.11.38] - 2026-09-03

### Improved

- Expand the visual tab overview into a near-full-window Mission Control surface and refresh last-good previews while it remains open, with bounded capture work that pauses outside the focused window and never wakes sleeping tabs.

## [1.11.37] - 2026-09-03

### Added

- Turn **Search tabs** into a searchable visual overview with workspace-grouped thumbnails, clear current-tab highlighting, keyboard navigation, and responsive layouts for crowded sessions.

### Fixed

- Keep focus and unrelated browser shortcuts behind the modal tab overview, preserve search-field caret movement and shortcut toggling, bound sparse layouts, reject malformed preview requests, and retain lock-safe tab selection.

## [1.11.36] - 2026-09-03

### Fixed

- Remove legacy **Start here** onboarding and licensing boilerplate when regenerating an existing GitHub release, keeping every release changelog focused on that version's changes.
- Move keyboard focus into a trusted modal when a background-open wallet approval, Settings window, or other Hronaut dialog becomes active, preventing hidden shell fields from retaining input.
- Restore wallet-provider access after an isolated workspace deletion rolls back, while keeping requests from the closed tab lifecycle cancelled.
- Keep a submitted address visible while a slow destination is still connecting instead of briefly clearing the address bar.
- Keep unrelated human mouse and keyboard events blocked while an agent sends an exact authorized input sequence to a locked website tab.
- Replace an existing application notification in place so rapid sequential failures never expose duplicate live alerts.
- Reject stale context-menu download actions as soon as their tab closes, even while Electron is still tearing down its page renderer.

## [1.11.35] - 2026-09-03

### Added

- Add a client-specific setup guide action to Hronaut Home for every supported coding agent, opened through a trusted Hronaut-only URL allowlist in the system browser.

### Fixed

- Require fresh trusted-dialog focus for every queued wallet approval so a repeated Enter or Space cannot approve the next request without a new review.
- Keep GitHub release-note reruns idempotent so the generated comparison section never accumulates duplicate separators.
- Recheck native window focus immediately before focusing an automatic trusted dialog so a wallet approval, Settings, or What's new prompt cannot reactivate Hronaut after the user switches to another application.
- Keep leaked commercial-license listeners inert when failed initialization cleanup also throws, preserving the real setup error and a clean retry path.
- Keep an in-flight update check or MCP Pause action authoritative and usable when automatic startup recovery retries its status subscription.
- Ignore leaked wallet listeners after failed startup cleanup so obsolete wallet state cannot repopulate Settings while the service reconnects.
- Suppress delayed credential-fill success or failure feedback after the human switches tabs or the original page navigates.
- Use the current interface language for delayed saved-password fill and removal errors instead of retaining the language active when Hronaut started.
- Cancel wallet import tokens that finish validation after the Wallets panel closes so abandoned recovery material is released from signer memory immediately.
- Show the human-readable workspace name in trusted wallet approvals, with the immutable workspace ID retained as a fallback when that workspace was removed.

### Improved

- Give the checksum manifest and every public Windows, macOS, and Linux installer a human-readable GitHub Release label while keeping updater metadata machine-readable and unchanged.
- Make installed Linux packages discoverable in GNOME and KDE launcher searches for browsers, MCP, coding agents, automation, QA, and testing.
- Reuse ESLint's content cache across hosted CI runs so small follow-up changes receive substantially faster static feedback without skipping any validation gate.

## [1.11.34] - 2026-09-02

### Fixed

- Stop a human tab close from completing after **Block input** engages while Hronaut is waking the replacement tab; agent-driven closes remain available.
- Keep leaked browser, settings, and MCP status listeners inert when failed startup cleanup also throws, preserve the original initialization error, and allow a clean retry.

### Improved

- Add a GitHub support resource that routes setup, product defects, security reports, and licensing questions to focused privacy-safe channels.

## [1.11.33] - 2026-09-02

### Added

- Add copy-ready starter workflows for authenticated handoff, localhost defect triage, and responsive review with explicit workspace and privacy boundaries.

### Fixed

- Keep trusted modal cleanup from restoring stale Hronaut focus while another application owns input, and fail closed if the native focus query is unavailable.
- Invalidate later cached changelog pages after a successful refresh so newly shifted releases cannot disappear at a page boundary.
- Ignore a leaked native update listener after failed startup cleanup so stale release state cannot overwrite a successful retry.
- Refresh transitive URI and query-string parsing dependencies to patched BSD-licensed releases after newly published host-confusion, SSRF, and denial-of-service advisories.
- Close active Chromium connections when tearing down integration HTTP fixtures so otherwise-passing Docker cases cannot spend their timeout waiting on idle sockets.
- Stop panel-dock watchers, queued layout IPC, and active resize listeners when the shell layout controller is disposed.
- Roll back page capture, export, and diagnostics resources when page-tools panel composition fails during application startup.
- Let focused static validation accept intentionally ignored documentation files without turning ESLint's ignored-file notice into a false failure.

### Improved

- Make Hronaut's published Agent Skill discoverable for authenticated browser QA, localhost and responsive testing, accessibility checks, and performance diagnosis.
- Add copyable GitHub attestation and SHA-256 verification steps for unsigned release downloads to the README.
- Serialize focused Docker dependency-cache initialization so concurrent cold starts cannot observe a partially populated cache.
- Split hosted Electron integration coverage across three balanced shards to shorten feedback while retaining all scenarios.
- Keep `App.vue` composition-focused by grouping page-tools and panel wiring, owned surface handles, and lifecycle cleanup in a dedicated controller.

## [1.11.32] - 2026-09-02

### Fixed

- Stop delayed address-navigation errors and site-summary responses from updating the shell after its navigation controller has been disposed.
- Show trusted wallet approval requests immediately for MCP agent signing and transaction operations instead of waiting for an unrelated UI refresh or window resize.
- Make the What's new Refresh action bypass its short-lived GitHub cache while retaining cached release history as an offline fallback.
- Keep generated GitHub release notes focused on version changes instead of repeating the product demo, downloads, setup clients, and license introduction.
- Prevent concurrent DOM-changes panel refreshes from leaving the trusted diagnostics UI stuck in a loading state.
- Keep release reruns from treating retained Playwright diagnostics as downloadable application assets.

## [1.11.31] - 2026-09-02

### Added

- Add a guided Home troubleshooting path that opens the MCP connection check in the system browser and offers a privacy-safe way to report unresolved setup trouble.

### Fixed

- Keep troubleshooting visible when an agent's first tool call fails, and only enable setup referrals after at least one successful agent action.
- Keep the Home success card aligned with its available feedback and recommendation actions instead of showing stale connection and licensing guidance.
- Prevent agent-driven scrolling from reclaiming keyboard or mouse focus on Linux while Hronaut is in the background, including when page input is blocked.

### Improved

- Publish human-readable titles and conservative MCP safety annotations for every tool so compatible clients can distinguish pure inspection from browser, storage, file, and wallet actions without weakening Hronaut's enforced boundaries.
- Keep `App.vue` composition-focused by moving shell interaction routing, keyboard precedence, and shortcut lifecycle handling into a dedicated controller.
- Reuse focused Docker dependency images and volumes across release-only version bumps while still invalidating the cache when dependencies, the dependency lock graph, or the test image changes.

## [1.11.30] - 2026-09-02

### Added

- After its first successful agent action, Hronaut Home can copy a privacy-safe recommendation with an attributable public link, without including browser, workspace, or agent data.

### Fixed

- Keep Hronaut from reclaiming keyboard or mouse focus when the user leaves the app during an already-running agent action, including after **Block input** is enabled.
- Prevent automatically opened trusted dialogs, including wallet approvals, from taking keyboard focus when Hronaut is in the background.
- Prevent an obsolete detached-panel open failure from redocking a newer panel selection.
- Keep the enabled workspace New Tab button, keyboard shortcut, and context-menu action usable while global page input is blocked; newly opened pages remain protected by the same lock.
- Keep trusted element and screenshot-area selection responsive on locked pages when an agent click, key press, or other input finishes while the human selection is still active.

## [1.11.29] - 2026-09-02

### Added

- After Hronaut completes its first agent tool call, Home offers a privacy-safe **Share your setup result** action that opens the existing structured GitHub feedback form in the system browser without attaching runtime data.

### Improved

- Rename the global tab-lock control to **Block input** and clarify across all supported languages that it blocks human website input and tab closing while Hronaut controls and agents keep working; foreground-focus protection remains automatic regardless of this setting.

## [1.11.28] - 2026-09-02

### Added

- Add first-class Windsurf Cascade setup on Hronaut Home, including Streamable HTTP configuration, connection verification, and owner-token file interpolation that avoids copying authentication secrets into JSON.

### Fixed

- Prevent background agent input from activating Hronaut when Electron restores the main window's focusability, including while tabs are locked on Linux desktop environments that focus a window during that transition.

## [1.11.27] - 2026-09-02

### Fixed

- Prevent background MCP JavaScript evaluations from taking keyboard or mouse focus from the application a person is using; unexpected dialogs are safely dismissed on isolated evaluations, while DevTools-open tabs retain compatible guarded evaluation.

## [1.11.26] - 2026-09-02

### Fixed

- Keep MCP `browser_evaluate` alert and confirm handling from activating Hronaut while a person works in another application, and preserve explicit accept/dismiss behavior on pages whose Content Security Policy blocks page-level `eval`.

## [1.11.25] - 2026-09-02

### Fixed

- Prevent trusted agent clicks from activating the Hronaut window while the person is working elsewhere, including when Lock Tabs temporarily permits agent input to a locked page.

## [1.11.24] - 2026-09-02

### Fixed

- Agent presentation and attention requests no longer steal keyboard or mouse focus when their target is already visible in split view.

## [1.11.23] - 2026-09-01

### Fixed

- Keep MCP `browser_show` non-activating even when Lock Tabs is off, so an agent can reveal Hronaut for observation without taking keyboard or mouse focus from the application a person is using.

## [1.11.22] - 2026-09-01

### Added

- Add trusted per-workspace Site access policies with exact origins, boundary-safe subdomain wildcards, and loopback port wildcards. Restricted policies cover direct and MCP navigation, redirects, page links and forms, popups, and back/forward history; they persist across restart and archive/restore while agents remain unable to change them.
- Add a bounded, trusted blocked-navigation log that records only origin, reason, source, and time without persisting denied paths, queries, fragments, or embedded credentials.

### Fixed

- Treat a policy-blocked redirect as an intentional cancellation instead of surfacing a generic Chromium load failure.
- Check back and forward targets before Chromium changes history so a disallowed origin cannot bypass a workspace policy.

## [1.11.21] - 2026-09-01

### Fixed

- Prevent the MCP `browser_show` tool from taking foreground keyboard or mouse focus while Lock Tabs is active; agents can still make the window visible without interrupting work in another application.

## [1.11.20] - 2026-09-01

### Fixed

- Keep Lock Tabs from moving keyboard or mouse focus into Hronaut chrome when its state changes, while retaining the native input barrier that blocks physical interaction with locked website pages.
- Reject credential-bearing HTTP(S), `view-source:`, and origin-bound `blob:` URLs across agent workspace navigation so embedded usernames or passwords cannot enter live tabs through direct commands, redirects, or website popups.

### Improved

- Make release auto-tagging idempotent when a matching signed tag is published concurrently, while still failing closed if the remote tag points at another commit.

## [1.11.19] - 2026-09-01

### Fixed

- Block local-file and privileged/internal-scheme navigation in agent-owned workspace tabs, including direct commands, redirects, popups, and restored profile state, so MCP browser access cannot become an unrestricted local-content viewer. Existing unsafe persisted tabs are repaired to blank documents without preventing startup. Normal web, embedded QA, and origin-bound blob documents remain supported; the explicit file-upload tool still attaches agent-supplied local paths only to website file inputs.

## [1.11.18] - 2026-09-01

### Fixed

- Preserve the human's active window and trusted-chrome focus across agent clicks, typing, and key presses, including when page input is locked, so background MCP work cannot reactivate Hronaut and capture physical keyboard or mouse input.

## [1.11.17] - 2026-09-01

### Fixed

- Keep trusted wallet approvals above website content even when a delayed shell measurement arrives, so connection, signing, and transaction confirmations no longer appear only after resizing the window.
- Point the desktop repository's static reference site at the canonical Hronaut storefront and provide complete large-card Open Graph metadata instead of identifying GitHub as the shared page.

### Improved

- Keep the reference site's appearance copy aligned with all eight built-in palettes plus System mode.

## [1.11.16] - 2026-09-01

### Fixed

- Keep Wallet Standard `silent` and legacy `onlyIfTrusted` Solana reconnect checks from opening trusted approval UI before a site has address permission.
- Support the `off` event-listener cleanup used by maintained Solana wallet adapters so disconnecting cannot stall before Hronaut receives the request.
- Wait for the persisted tray-close preference before exercising process shutdown in release validation, removing a race that could leave the test app hidden in the tray and block otherwise valid packages.
- Shut down wallet brokers before deleting their temporary vaults in unit tests so background confirmation and audit work cannot race test cleanup on slower runners.

## [1.11.15] - 2026-09-01

### Release status

- Not published: release validation detected a wallet broker teardown race before any binaries were built. The fixes are included in 1.11.16.

## [1.11.14] - 2026-09-01

### Release status

- Not published: release validation detected a flaky tray-close test before any binaries were built. The fixes are included in 1.11.15.

## [1.11.13] - 2026-09-01

### Fixed

- Publish legacy Solana `publicKey` and connection state after selecting Hronaut so compatible dapps stop waiting and can continue to their trusted approval flow.
- Dispatch agent keyboard shortcuts through Chromium's awaited input channel so background-focus races cannot report a successful key press that the page never received.

## [1.11.12] - 2026-09-01

### Fixed

- Hide native website views while trusted Hronaut dialogs are open so wallet approvals appear immediately after a dapp selects Hronaut, without requiring a window resize, and restore the page between consecutive requests.

## [1.11.11] - 2026-09-01

### Changed

- Clarify Wallets onboarding with descriptive Generate, Import, and Watch-only choices, outcome-specific actions, a distinct wallet-management state, signing-key controls only when a signing wallet exists, and an automatic handoff to the newly added wallet without leaving duplicate-ready form values behind.

### Fixed

- Reveal the GitHub-backed **What's new** reader immediately above normal website content without requiring a window resize, including at the minimum supported window size.
- Refresh Responsive Preview controls from the applied tab viewport after closing and reopening during a pending Apply, without letting an older failure overwrite a newer draft.
- Reveal trusted wallet connection and signing approvals immediately above website content without requiring a window resize, and keep approval actions visible while reviewing long requests.
- Refresh Environment controls from authoritative tab state when a pending Apply finishes across close and reopen cycles, without letting an older failure overwrite a newer draft.
- Keep the Workspace editor visible and clearly busy while saving, closing, or copying browser data; block every dismissal and conflicting edit path until the authoritative operation finishes.
- Keep validated wallet imports visible and immutable until trusted cancellation finishes, preventing a stale cancellation from colliding with a newer onboarding attempt.
- Keep wallet rename and RPC drafts open for retry when persistence fails, prevent conflicting inline editors, and lock drafts while their update is in flight.
- Keep transaction-automation drafts scoped to the selected signing wallet, clear successful policy forms to prevent accidental duplicates, and reject misleading bounded automation policies for watch-only wallets.
- Cancel validated wallet imports when the trusted Wallets panel closes or changes sections so abandoned recovery material is removed from signer memory immediately instead of waiting for expiry.
- Let hidden full-page screenshots use Chromium's own capture presentation path instead of waiting on an unrelated compositor subscription that can be missed under load.

## [1.11.10] - 2026-09-01

### Fixed

- Send a plain-data wallet import confirmation through Electron IPC so validated mnemonic and private-key imports can be encrypted instead of failing with a data-clone error.

### Improved

- Make wallet imports a clear two-step flow that moves focus to a public-details review, explains when local encryption occurs, shows workspace access, and provides an explicit **Add encrypted wallet** action.

## [1.11.9] - 2026-08-31

### Fixed

- Keep every trusted Settings descendant outside title-bar drag regions so Wallet form fields and selectors remain interactive after locking and unlocking tabs.

## [1.11.8] - 2026-08-31

### Fixed

- Return the canonical cancellation result when wallet removal races request preparation, instead of exposing an internal approval-state transition error to the website provider.

## [1.11.7] - 2026-08-31

### Added

- Add a privacy-safe general bug-report form with reproducibility fields and explicit guidance to keep browser, wallet, and MCP secrets out of public issues.

### Improved

- Restyle the GitHub-backed **What's new** history as a compact release reader with date/version headers, denser categorized notes, and a narrower scrollable dialog.

### Fixed

- Drain queued bookmark, credential, site-permission, and commercial-license writes during shutdown so recent changes are not lost when Hronaut quits immediately after an action.
- Keep a newer wallet-vault lock or application shutdown authoritative when an asynchronous unlock is still waiting on the operating-system credential store, preventing stale completion from restoring decrypted key material.
- Restore the cached What's new history to a ready state when its dialog closes during a refresh, instead of leaving the controller permanently marked as loading.

## [1.11.6] - 2026-08-31

### Changed

- Add a three-step first-run path, workflow links, platform/CI badges, and machine-readable package discovery metadata to make the public repository easier to evaluate and adopt, and send first-time downloads through the curated OS/package chooser instead of GitHub's raw asset list.
- Link future unsigned-package release warnings directly to the SHA-256 and GitHub attestation verification guide.

### Fixed

- Drain queued browsing-history writes during shutdown so the final visit is not lost when Hronaut quits immediately after navigation.
- Hand the GitHub-backed **What's new** view off from Settings and About instead of stacking multiple `aria-modal` dialogs, keeping focus and assistive-technology semantics on one trusted surface.
- Treat **What's new** as a real keyboard modal so Escape closes it and application shortcuts cannot execute behind it.
- Keep older stable releases reachable when a GitHub history page contains only filtered prereleases.
- Repair the public security-policy link and guard repository-relative README links against future 404s.

## [1.11.5] - 2026-08-31

### Added

- Add a trusted, paginated **What's new** view in About and Software updates that renders sanitized notes from GitHub Releases, keeps GitHub as the single source of truth, and retains recently loaded history when the network is temporarily unavailable.

## [1.11.4] - 2026-08-31

### Fixed

- Disable configured-wallet mutations while another wallet operation is still refreshing, preventing a fast second click from being silently discarded.

## [1.11.3] - 2026-08-31

### Fixed

- Close Chromium keep-alive connections before local HTTP fixture teardown in long Electron shards, preventing completed shell tests from exhausting the global timeout during cleanup.
- Keep EIP-1193 accounts scoped to the active chain, switch among configured workspace networks with the required provider events, route signing to the requested permitted account, and notify connected dapps when account access changes after vault locking, permission revocation, wallet removal, or network fallback.
- Drive wallet-request expiry regression timing with a controlled clock so loaded CI runners cannot let the fixture expire before the test captures it.
- Scope native input-guard failure injection to the lock operation under test so background debugger synchronization cannot consume the one-shot failure on loaded CI runners.

## [1.11.0] - 2026-08-31

### Added

- Add chain-aware wallet onboarding with curated EVM, Solana, and TRON network presets, editable RPC endpoints, a full custom-network path, and explicit public-RPC/mainnet safety guidance.
- Let each wallet use either an explicit workspace allowlist or an opt-in **Any workspace** scope that also covers future workspaces, without granting address or signing permission.
- Let a dedicated EVM agent wallet opt into a short-lived, fully bounded **Bypass Approve** policy for exact mainnet agent transactions, while websites and requests outside the delegation still require trusted approval.

### Fixed

- Explain wallet-vault locking in context, make it reliably clear OS-protected signing keys from memory, and provide a system-secure-storage unlock path without requesting an irrelevant passphrase.
- Switch wallet imports between a mnemonic phrase textarea and a masked private-key field, clearing any entered secret when the format changes.
- Let configured wallets replace a failed or rate-limited RPC endpoint without recreating their signing identity, while cancelling pending requests and removing endpoint-bound automatic policies.
- Replace Electron's unsupported wallet-rename prompt with an inline trusted editor, and add accessible labels to vault passphrase controls.
- Require an explicit saved workspace selection for bounded wallet policies, preventing policies from silently targeting the first attached workspace.
- Keep bounded-policy submission disabled until its origin, destination, method, limits, expiry, and operation count are valid.
- Validate trimmed custom network identifiers, names, and HTTP(S) RPC URLs before wallet submission, while accepting harmless surrounding whitespace in EVM chain IDs.
- Return a normal validation error for partially typed or malformed wallet RPC URLs instead of letting URL parsing throw from the shared schema.
- Show public-RPC rate-limit guidance only for presets that actually use a public endpoint, not local or custom networks.
- Revalidate automatic-policy expiry and mainnet Bypass Approve invariants at the final serialized signing boundary, preventing a queued transaction from signing after its delegation expires.
- Scope active and archived MCP workspaces to the creating connection, hide other clients' identifiers and label collisions, preserve workspace identity through archive recovery, return a private cleanup capability for retained failed forks, and require that capability before a reconnect can recover persistent browsing state.
- Require human approval for Solana and TRON public-testnet signing until their RPC endpoints can be independently attested, preventing a retained testnet label paired with a mainnet RPC from authorizing automatic transactions.
- Validate custom EVM chain IDs inline and in every trusted wallet-creation path, preventing malformed or unsafe IDs from being persisted and failing later during RPC operations.
- Keep configured wallet RPC endpoints, embedded transport credentials, raw adapter failures, and simulation logs out of MCP responses and durable approval state.
- Keep EVM, Solana, and TRON network identity fields synchronized when switching chains instead of retaining incompatible IDs and endpoints from the previous family.
- Freeze validated import details until confirmation or cancellation so a prepared secret cannot be saved with another chain family's network metadata.
- Keep new-wallet workspace choices independent from the configured-wallet access editor.
- Keep the selected settings section visible at narrow window sizes by using a compact horizontally scrollable navigation strip.
- Route ordinary vertical mouse-wheel input through the responsive Settings section rail without trapping page scroll at either boundary.
- Replace stale Scroll and Celo testnet RPC presets, correct Sonic Testnet's chain ID, and remove the deprecated Taiko Hekla preset.
- Publish message-signing approvals only after their simulation audit is durable, closing a permission-revocation race exposed by hosted CI.

## [1.10.1] - 2026-08-31

### Fixed

- Keep the trusted Settings surface outside Electron title-bar drag regions so wallet names, native selectors, and other controls remain interactive across tab layouts, locked pages, and scaled interfaces.
- Prepare the packaged Windows profile with the Complete MCP tool set before exercising persistence, so the Scoop install smoke verifies its intended `browser_evaluate` workflow instead of failing against the new Browser Essentials default.

## [1.10.0] - 2026-08-30

### Added

- Add profile-wide Browser Essentials, Web QA, and Complete MCP tool sets, with localized Settings controls and deterministic catalogs for every connected client.
- Add local, encrypted EVM, Solana, and Tron wallets with generated, imported, watch-only, and dedicated-agent records; workspace/origin permissions; trusted approval; simulation; bounded local/testnet policy automation; and hash-chained non-secret audit history.
- Add standards-oriented EIP-1193/EIP-6963, Solana Wallet Standard, and TIP-6963 website providers, plus narrowly scoped MCP wallet list, balance, prepare, request, status, and cancellation tools that never expose or approve secrets.

### Changed

- Keep `App.vue` composition-focused by moving tab search, find, zoom, browser collections, workspace editing, credential selection, and the command palette into one focused transient shell layer with a narrow imperative surface.
- Keep `App.vue` composition-focused by moving Settings, trusted wallet approval, and Help mounting into a dedicated dialog layer with explicit controller contracts.
- Keep Hronaut Home aligned with the public client matrix by adding profile-aware Kiro, Mistral Vibe, and Warp setup guides, including environment-backed credentials where those clients support them.
- Parallelize standalone incremental typechecks with a constrained-runner override, run release validation concurrently, and stop repeating successful type analysis in dependent platform packaging jobs.
- Run the two hosted Electron shards on isolated runners and record Playwright traces only on a strict first retry, shortening successful Docker gates without accepting flaky tests.
- Add a warm full-suite Docker preflight that reuses lock-keyed dependencies, skips duplicate type analysis, and runs the complete Electron and native-dialog suite across six local shards while preserving the immutable authoritative gate and two-shard hosted profile.
- Add a focused static validation command that runs content-cached ESLint concurrently with only the incremental TypeScript projects affected by the edited files, and include website TypeScript in both focused and full lint coverage.
- Synchronize physical X11 pointer and wheel delivery in Docker interaction-lock QA so concurrent Electron shards cannot mistake an undelivered probe for a still-locked page.
- Keep setup feedback and generated release guidance aligned with all fourteen focused coding-agent guides, so users can identify their actual client instead of falling back to a generic category.
- Link every focused coding-agent setup guide from the GitHub README so visitors can move directly from their client to the local Hronaut connection flow.
- Avoid repeating the full TypeScript analysis inside hosted Docker integration after the parallel validation job has already run it, while retaining typechecking in standalone Docker runs.
- Keep Docker's dependency layer keyed to the lockfile instead of unrelated package-script metadata, build the application once, and run the authoritative Electron suite across isolated Xvfb and MCP-port shards; focused Electron feedback also skips duplicate type analysis, targeted TypeScript and lint commands avoid unrelated work, and full lint uses a content-addressed cache.
- Reuse lock-keyed focused Docker dependency volumes, cap CI Vitest projects at two isolated fork workers, and provide an incremental full-project typecheck for faster repeated feedback without weakening the clean full gates.
- Start new profiles with the smaller Browser Essentials catalog while preserving the Complete catalog for existing profiles.
- Keep wallet keys and pending signable message bodies in trusted main-process memory only, encrypt managed records with XChaCha20-Poly1305, wrap the vault key with secure operating-system storage, and require Argon2id passphrase protection when Linux reports `basic_text` or no secure secret backend.
- Use the MIT-licensed RustCrypto Argon2id Node-API binding for the Linux passphrase fallback so the vault works in Electron runtimes that do not compile Node's optional Argon2 API.
- Clarify when Hronaut's persistent local browser model fits better than disposable or hosted automation, and document the Web3 trust model, mainnet approval boundary, and testnet automation limits.

### Fixed

- End a missed hidden-page frame subscription before probing readiness with Electron's independent page capture, preventing tray screenshots from timing out under concurrent renderer load.
- Roll back per-tab and global interaction-lock state when Chromium rejects a native input-guard update, including actively removing a partially applied compositor lock so websites cannot remain frozen behind an unlocked UI.
- Clean every wallet startup listener when initialization fails, preserving the source failure alongside any cleanup errors instead of leaking later listeners or masking the cause.
- Subscribe to wallet-service events before reading startup snapshots, preventing status, account, and approval changes during Settings bootstrap from being lost.
- Keep live wallet status and descriptor events authoritative over delayed post-operation snapshots, and stop refresh work cleanly when Settings disposes its wallet controller.
- Keep live wallet-request events authoritative over delayed Settings refreshes, preventing cancelled or expired approvals from reappearing and ensuring overlapping refreshes cannot restore older state.
- Keep trusted browser shortcuts available when only the focused website tab is interaction-locked, while continuing to block page keyboard input and global-lock tab closure.
- Replace the obsolete external-wallet proposal and its broken design-document link in the detailed reference with the implemented local EVM, Solana, and Tron wallet trust model and canonical security documentation.
- Verify Tron transaction JSON against its canonical protobuf bytes and transaction hash at normalization, simulation, signing, and broadcast boundaries, preventing substituted or post-approval-mutated data from being signed.
- Reject negative or unsafe EVM chain IDs and transaction nonces outside JavaScript's safe integer range instead of accepting invalid networks or silently rounding values before simulation, approval, and signing.
- Make MCP `browser_press` insert the intended shifted printable character, so combinations such as `Shift+x`, `Shift+1`, and `Shift+/` produce `X`, `!`, and `?` instead of their unshifted text.
- Store managed wallet descriptors, permissions, policies, and durable automation counters in one encrypted authenticated vault authority state; require a one-shot current-process authorization before key release; reject managed/watch-only identity collisions; migrate legacy plaintext authority by revoking grants and converting bounded automation to Always ask; and prevent an in-flight automatic request from signing after its selected policy is removed or tightened.
- Keep Home, normal browsing, tray, and non-wallet MCP tools available when wallet metadata is malformed or encrypted vault records fail authentication; disable wallet operations with a sanitized failure state, preserve damaged files for recovery, authenticate every encrypted record before reporting the vault ready, and survive Linux keyring availability changes without misclassifying valid passphrase vaults.
- Prevent physical mouse-wheel and compositor scrolling from bypassing per-tab or global website interaction locks, while keeping keyboard shortcuts, Hronaut Home, and trusted agent scrolling available.
- Give hidden tray screenshots enough bounded time to acquire a Chromium compositor frame under concurrent renderer load, while letting PDF export use Electron's independent print pipeline instead of waiting on a frame it does not consume.
- Drain in-flight wallet confirmation and audit work within a bounded shutdown window before locking the vault, preserve unresolved submitted transactions for restart recovery, and stop confirmation or expiry timers from racing disposed wallet state.
- Treat a tab closed during address navigation as a cancelled request instead of showing a false navigation failure after its replacement tab is active.
- Keep concurrent static validation from racing ESLint against Electron Vite's short-lived generated config bundle.
- Reject secret-bearing wallet payloads at every supported nesting level, fail closed when public/provider input exceeds the shared serialization depth, and reject oversized or sparse arrays, shared-reference graphs, and over-budget binary views before expansion, preventing deeply nested secrets and payload-amplification denial of service from reaching the trusted wallet broker.
- Give the theme picker proper radio-group keyboard behavior with one Tab stop plus wrapping Arrow, Home, and End navigation across all regular and expressive themes.
- Treat a sleeping tab closed during restoration as a cancelled selection instead of surfacing a false destroyed-renderer error after the healthy fallback tab is already active.
- Expose each workspace tablist's actual horizontal or vertical orientation to assistive technology so screen-reader guidance matches its arrow-key behavior.
- Speed up repeat validation with cached incremental typechecking, concurrent static gates, tunable Vitest workers, balanced four-way local Docker Electron sharding, and a resource-safe two-shard hosted CI profile.
- Trap keyboard focus inside trusted wallet approvals so a newly presented request cannot leave typing or tab navigation in the underlying website.
- Preserve Page Tools and other shell panels when the global interaction lock blocks a Developer Tools shortcut.
- Invalidate wallet request contexts synchronously on page navigation or tab closure and roll back overtaken account grants, preventing delayed preparation or permission persistence from authorizing a page that is no longer active.
- Preserve the wallet security guide when rebuilding the generated website output instead of deleting it during output cleanup.
- Bind wallet authorization sessions to server-issued MCP transport sessions, preventing another client from reusing a disclosed wallet session token even when both clients present the same User-Agent, removing terminated clients from live dashboard state, and keeping live MCP tool-set changes effective for connected clients.
- Drain and revoke in-flight agent wallet operations before MCP session termination or application shutdown completes, preventing late approval creation or bounded testnet signing after the requester has gone away.
- Keep wallet and tab lifecycle authorities available until MCP shutdown has durably cancelled agent approvals, so a clean application exit cannot leave them awaiting human action.
- Wait for MCP wallet-session request cancellation during listener shutdown, and contain cancellation failures instead of leaving cleanup in flight or producing an unhandled rejection.
- Bind EVM approvals to a fully prepared transaction, including nonce, gas, fee fields, and normalized transaction type, before signing.
- Keep mislabeled mainnets and unknown networks out of bounded automation even when their saved environment claims to be a testnet or local chain.
- Show trusted approval UI the exact canonical message or typed data while keeping message bodies out of durable records and agent responses.
- Reject forged wallet JSON type tags and prototype-like keys, return standards-shaped EIP-1193 errors, and present wallet-vault security states without leaking internal enum values.
- Remove horizontal crowded-tab scroll controls as soon as the tabs fit the full strip again, and keep the Home loading indicator visible in compact and collapsed layouts.
- Stop native tray attention when its requested tab or workspace closes instead of leaving a stale pulsing request behind.
- Let agents show Hronaut or request human attention before their workspace contains a browser tab, while keeping pending tabless requests visible only to their originating workspace.
- Authenticate and validate request origins before parsing MCP JSON bodies, so unauthorized malformed or oversized payloads cannot consume the parser first.
- Cancel and reject live wallet requests when a wallet is detached or removed, its account permission is revoked, or its website renderer is destroyed; clear retained message bytes and revalidate attachment and permission immediately before signing.
- Automatically zero and discard unconfirmed imported wallet secrets when their five-minute confirmation window expires, even while Settings remains idle.
- Remove a wallet's bounded automation policies when it is detached from their workspace, preventing old authorization from silently returning after a later reattachment.
- Reject expired wallet policies and path-bearing policy URLs before persistence, keeping bounded automation tied to exact HTTP or HTTPS origins that can actually match requests.
- Roll back newly generated wallets when recovery confirmation is declined or fails, instead of retaining an unusable account whose recovery phrase cannot be shown again.
- Scope Solana disconnect to the selected wallet and requesting site, cancel its pending signatures, and preserve unrelated same-origin chain permissions.
- Expire untouched wallet approval requests at their deadline, reject the waiting website caller, and clear retained message bytes without requiring a click or restart.
- Fail wallet request preparation closed so connection, transaction, and message setup errors cannot leave stale requests available for approval.
- Always settle wallet callers and clear retained message bytes after approval, rejection, cancellation, revocation, or expiry, even when audit persistence fails after the terminal state change.
- Keep polling submitted wallet transactions until confirmation becomes terminal, resume confirmation tracking after restart, and record submission and confirmation in the immutable audit history.
- Keep MCP wallet addresses hidden from request-status and cancellation responses until account permission is active, and bind those operations to the exact page origin and navigation that created the request.
- Keep Repro recorder copy confirmation visible when a background recording refresh arrives immediately after the clipboard write.
- Keep the packaged MCP smoke aligned with the Complete tool catalog it verifies after new profiles began defaulting to Browser Essentials.

## [1.9.11] - 2026-08-28

### Changed

- Add a focused Docker/Vitest command for fast file- or case-level unit and component feedback without building or launching Electron.

### Fixed

- Treat Electron's aborted page loads as normal navigation supersession and keep stale address submissions from showing a false failure over the newer page.
- Keep delayed native workspace-editor requests from opening over a newer Settings, Help, Command Palette, or credential dialog.
- Keep keyboard and programmatic focus inside the active Hronaut modal, including reverse tabbing at the minimum window size and 125% interface scale.
- Keep the current page visible when closing it would require a sleeping replacement that cannot wake, and preserve newer tab selections while replacement restoration is pending.
- Keep the active split-view pane attached and visible when its inactive partner closes.
- Add credential-free one-click VS Code MCP setup from Hronaut Home while retaining manual setup for authenticated profiles.
- Recover Hronaut Home endpoint and client setup instructions after committed MCP or language changes even when the main-process reload fails.

## [1.9.10] - 2026-08-28

### Changed

- Move the browser tabs, title-bar surfaces, navigation controls, and page actions into a focused presentation layer while keeping application orchestration in `App.vue`.
- Speed up focused Docker/Xvfb regression runs by reusing a dependency-only image layer and bind-mounting the live checkout, while keeping the full immutable-image Docker suite as the delivery gate.

### Fixed

- Serialize native website permission prompts and revalidate queued requests before showing them.
- Preserve MCP download ownership when an archived workspace is reopened with a new workspace ID.
- Wait for in-flight workspace storage changes to finish before flushing browser profiles during shutdown.
- Let the release workflow advance the last verified Scoop manifest only after new artifacts and checksums exist, instead of blocking artifact creation on a future manifest.
- Retry transient Chromium profile-directory cleanup races in Electron integration fixtures.

## [1.9.9] - 2026-08-28

### Added

- Add a focused Docker/Xvfb Playwright command for fast file- or test-level regression feedback while keeping the full Docker suite as the delivery gate.
- Add a portable Hronaut Agent Skill for safe workspace creation, semantic browser interaction, and human handoff across skill-aware coding clients.

### Changed

- Move the page-tools and developer-panel presentation layer out of `App.vue` while preserving its controller-owned panel models and imperative handles.

### Fixed

- Keep the native Pick Element action from starting a hidden website picker behind command-palette, workspace, credential, Help, and Settings modals.
- Preserve newer human tab selections while MCP wakes a sleeping selection target, and close sleeping MCP tabs without reloading them first.
- Attribute MCP activity to the validated tab in the requested workspace, including while an omitted-target command wakes a sleeping tab.
- Keep the native Command Palette action from opening behind workspace and credential modals, so the visible dialog remains authoritative for Escape and focus handling.
- Preserve the existing browser session when Hronaut receives a quit request before cold-start tab restoration begins, instead of flushing an uninitialized empty model over `tabs.json`.
- Keep detached tool-panel switches exclusive, preserve newer user selections and close actions over queued native presentations, and keep automatic refresh bookkeeping from cancelling a newer native request.
- Wait for sleeping tabs to wake successfully before presenting them from tray and MCP attention actions, preserving the current visible tab when restoration fails.

## [1.9.8] - 2026-08-28

### Fixed

- Keep a focused address-bar selection authoritative while an earlier navigation commits, so rapid consecutive searches cannot append the new query to a redirected page URL.
- Keep Hronaut Home controls interactive while the global website-tab interaction lock is enabled.

## [1.9.7] - 2026-08-28

### Changed

- Move Downloads, Bookmarks, and History panel rendering out of `App.vue` into a focused browser-collections layer while preserving controller-owned panel refs and models.
- Consolidate active-tab presentation, origin-scoped credential filling, emulation labels, and detached-panel state behind a focused feature controller, keeping `App.vue` composition-focused.
- Extract active-tab derivation, diagnostic-log preservation, and MCP tab-activity composition from `App.vue` into a focused runtime feature controller.
- Extract full-modal state, shell geometry, and competing-overlay coordination from `App.vue` into a focused layout feature controller.
- Extract shell appearance, custom title-bar, detached-panel, tab-rail, and panel-dock presentation composition from `App.vue` into a focused feature controller.
- Extract startup task aggregation, bounded recovery, and coordinated teardown from `App.vue` into a focused feature controller.
- Update the embedded accessibility and performance audit engines to axe-core 4.13.0 and web-vitals 6.2.1.

### Fixed

- Persist profile state through one exclusive randomized atomic-file writer, preventing predictable temp-file symlinks from redirecting credentials, license data, tabs, settings, permissions, history, bookmarks, or window-state writes onto unrelated user files.
- Prefix Windows reserved device names suggested by websites before allocating download paths, while preserving normal filenames and collision-safe numbering.
- Search scheme-less email-shaped address-bar input instead of interpreting it as URL credentials, while preserving `@` characters in valid URL paths.
- Reject Windows reserved device names for requested PDF and sanitized HAR exports, and prefix title-derived reserved names so generated files remain portable across supported platforms.
- Bind native website-permission prompts to the exact requesting frame, preserving valid cross-origin iframe grants while rejecting late decisions after frame or tab navigation and destruction.
- Strip embedded HTTP credentials from bookmark and visit-history fallback titles, and repair existing credential-bearing history records instead of dropping them.
- Keep MCP download history, save paths, cancellation, and clearing isolated to the agent workspace that created each download.
- Strip embedded HTTP credentials from active and archived tab URLs before persistence, and repair credential-bearing profile state during startup.
- Recover from malformed profile MCP token files by generating one new owner-only token instead of leaving Hronaut running without a window or MCP listener.
- Keep simultaneous same-named website downloads in distinct collision-safe files instead of silently overwriting one response.

## [1.9.6] - 2026-08-28

### Added

- Add localized, profile-aware Zed setup to Hronaut Home with its remote `context_servers` schema, explicit non-OAuth marker for unprotected profiles, and live status verification.
- Add localized, profile-aware Devin Local setup to Hronaut Home with current user-scoped configuration, owner-token file interpolation, and connection verification commands.
- Add localized, profile-aware JetBrains Junie setup to Hronaut Home using the user-level MCP configuration shared by Junie CLI and JetBrains IDEs.
- Add localized, profile-aware Kilo Code setup to Hronaut Home with trusted token-file references and a connection verification command.
- Add localized, profile-aware Cline setup to Hronaut Home with explicit Streamable HTTP configuration, authentication-aware headers, approval-safe defaults, and a connection verification command.

### Changed

- Extract workspace-editor visibility and create, edit, and close routing from `App.vue` into a focused shell controller.
- Refresh patch-level application dependencies and expand release/setup-feedback client discoverability for current MCP clients.
- Extract app-level keyboard surface priority and shortcut composition from `App.vue` into a focused feature controller.
- Extract application command-palette routing from `App.vue` into a focused feature controller.
- Extract site controls, storage, privacy, and settings navigation composition from `App.vue` into a focused feature controller.
- Extract responsive-preview and environment-emulation composition from `App.vue` into a focused feature controller.
- Extract Downloads, Bookmarks, and History composition from `App.vue` into a focused browser-collections feature controller.

### Fixed

- Accept the case-insensitive HTTP `Bearer` authentication scheme used by standards-compliant MCP clients.
- Recover with safe defaults when profile persistence files contain a valid JSON value with the wrong shape instead of failing Hronaut startup.
- Make a first-instance `--quit` request exit cleanly instead of launching a new Hronaut window and MCP listener.
- Keep launch-only MCP port overrides separate from saved preferences so unrelated settings changes cannot persist the temporary port.
- Ignore unchanged MCP port submissions while the healthy listener is already running, while still allowing same-port recovery after a listener failure.
- Make concurrent first-start MCP token loads converge on one atomically published owner-only token without temporary-file collisions or token replacement.
- Include IPv6 cookie-only sites in browsing-data inventories without producing double-bracketed invalid origins.
- Persist the anonymous commercial-license installation identity on first load so activation device names remain stable across restarts.

## [1.9.5] - 2026-08-27

### Changed

- Extract panel registration, transient-panel coordination, detached-window synchronization, and developer-panel actions from `App.vue` into a focused feature controller.
- Extract page capture, export, diagnostics, and page-tools presentation composition from `App.vue` into a focused feature controller.
- Update Electron 42 to 42.10.1 for upstream window, Wayland, shutdown, printing, and renderer reliability fixes while the Electron 43+ migration remains blocked upstream.

### Fixed

- Release failed detached-panel windows and clear their runtime owner so a later detach request can retry after a renderer load failure.
- Remove malformed, duplicate, unsafe, expired, and overflow bookmark, credential, permission, and visit-history records from the persisted profile during startup repair instead of leaving filtered private data on disk.
- Strip embedded usernames and passwords from HTTP(S) bookmark URLs before storing them.

## [1.9.4] - 2026-08-27

### Changed

- Move settings, update, MCP, license, privacy, permission, credential, download, performance, and search feature composition out of `App.vue` into a focused controller.

### Fixed

- Keep replacement MCP listeners paused while port or reset settings are staging, then apply the latest pause and authentication state atomically at cutover.
- Generate Gemini CLI Streamable HTTP setup with its documented `httpUrl` schema so copied Hronaut Home configuration connects successfully.

## [1.9.3] - 2026-08-27

### Changed

- Document the release-synchronized Scoop command for installing the verified Windows x64 portable build and Start Menu shortcut.

### Fixed

- Keep MCP paused until password decryption and page injection finish, even when the user requests Resume during the fill.
- Keep MCP paused for the full browsing-data cleanup and preserve newer user or credential-fill pause intent when cleanup finishes.
- Complete renderer teardown even when one native listener or controller disposer throws, preventing later IPC subscriptions, timers, and shell resources from surviving an unmount.
- Roll back earlier native event subscriptions when a later subscription fails during renderer startup, preventing duplicate or orphaned IPC listeners after a retry.
- Roll back partially attached Downloads, Bookmarks, and History listeners when collection startup fails, allowing a clean retry without leaked or permanently missing updates.
- Fully tear down address-suggestion watchers and native overlay listeners after failed setup or shell disposal so queued work cannot reopen the overlay or navigate a page afterward.
- Roll back live MCP activity subscriptions when tab tracking cannot start and always clear agent badges, request state, and linger timers even if native listener teardown fails.
- Preserve and report the real update-service failure when listener cleanup also fails, and always clear pending update UI operations during teardown.
- Preserve MCP and commercial-license source errors through listener cleanup failures, and clear their pending UI feedback before teardown completes.
- Roll back partial title-bar listener setup and always remove remaining geometry listeners and safe-area styles when one cleanup fails.

## [1.9.2] - 2026-08-27

### Fixed

- Ignore late shell notifications after renderer teardown so delayed clipboard or browser-action failures cannot recreate toast state and timers after the app has unmounted.
- Serialize Hronaut Home status polling so a slow local MCP response cannot create overlapping requests, starve dashboard updates as stale, or accumulate pending work.
- Generate PowerShell-safe authenticated Codex and Claude Code setup commands on Windows, including token paths with spaces or apostrophes.

## [1.9.1] - 2026-08-27

### Changed

- Move panel-dock preference validation and persistence out of `App.vue` into a focused controller shared by shell layout behavior.

### Fixed

- Always release Chromium's native pointer when an element or coordinate drag fails mid-movement so later human and agent input cannot remain stuck in a pressed state.
- Keep Hronaut usable when local layout preference storage cannot be read or written, falling back to safe panel sizes and preserving live dock and workspace-collapse actions.

## [1.9.0] - 2026-08-27

### Added

- Show copy-ready connection verification commands for Codex and Claude Code on Hronaut Home, matching the existing OpenCode and Gemini CLI guidance.
- Advertise Hronaut's persistent-workspace, semantic-inspection, and human-handoff workflow through MCP server instructions during client initialization.
- Let agents hover bounded viewport coordinates to reveal tooltips and hover states on canvas, WebGL, maps, remote desktops, and other visual-only surfaces.
- Let agents drag between bounded viewport coordinates for canvas, maps, custom controls, remote desktops, and other pixel-precise targets.
- Add first-class Gemini CLI setup, authentication-aware configuration, and connection verification to Hronaut Home.
- Add a localized, copy-ready first-success task to Hronaut Home so a newly connected agent can prove isolated workspace creation, navigation, and semantic inspection immediately.

### Changed

- Move renderer startup, window-listener wiring, and idempotent resource disposal out of `App.vue` into a focused lifecycle controller.
- Move bookmark and history entry navigation out of `App.vue` into the existing browser-collections shell controller.
- Move guarded, serialized Chromium Developer Tools toggles out of `App.vue` into the browser-tab action controller.
- Move site and update settings-entry policy out of `App.vue` into a focused navigation controller.

### Fixed

- Preserve keyboard focus when switching Hronaut Home setup guides and expose the selected client as an accessible pressed button.
- Close About before opening Commercial license settings so the two modal surfaces never stack.
- Keep Find cleanup running when a competing shell action throws synchronously.
- Make the complete horizontal “Workspace” action, including its visible label, clickable instead of limiting its title-bar hit target to the plus icon.
- Keep a horizontal-only `browser_scroll` action from also applying the default vertical scroll distance.
- Prevent an older bookmark or history navigation from closing a panel that the user reopened while that navigation was still pending.
- Clear stale Downloads actions when the panel is closed so an older reveal, cancel, or cleanup cannot lock or report errors in a reopened panel.
- Keep an externally reopened Downloads panel visible when an older refresh fails after another shell action or download event changed its visibility.
- Prevent queued Network refresh and request-condition actions from running inside a panel that was closed and reopened by newer shell coordination.
- Keep diagnostic “Copied” feedback scoped to the current page and restart its confirmation timeout when the same report is copied again.
- Keep Console, Network, Site Storage, and MCP endpoint copy confirmations scoped to the latest clipboard action and current context, with full confirmation time after repeated copies.
- Keep Hronaut Home on the newest status response and prevent repeated or guide-switched setup copies from clearing, sticking, or showing stale feedback.

## [1.8.0] - 2026-08-27

### Added

- Let agents wait for full or same-document navigation to reach a wildcard URL pattern, with prompt tab-close cancellation and redacted matched URLs.
- Let agents wait for a snapshot ref or CSS selector to become attached, detached, visible, or hidden without brittle JavaScript polling.
- Let agents single- or double-click bounded viewport coordinates for canvas, WebGL, maps, remote desktops, and other visual-only surfaces without weakening the preferred semantic-ref workflow.

### Changed

- Move Home navigation, last-website tracking, and competing-surface cleanup out of `App.vue` into a focused controller.
- Left-align Home and the title/tab cluster in horizontal mode, and align the vertical rail title to its left edge while preserving native window-control safe areas.
- Move shell-wide browser, startup, search, settings, and clipboard feedback out of `App.vue` into a focused controller.

### Fixed

- Prevent an already-finished page from timing out when loading stops between `browser_wait`'s state check and lifecycle-listener registration.
- Honor accept and dismiss consistently for alerts, confirmations, and prompts opened by agent clicks without racing another dialog handler.
- Keep hidden-tab screenshots, PDF exports, and visual comparisons reliable when Chromium renders the offscreen surface but omits its first presentation callback under load.

## [1.7.0] - 2026-08-26

### Added

- Add an all-platform, restart-required “Use system title bar” fallback for desktop environments where compact window controls are unreliable.
- Add Ctrl/Cmd+1–8 direct website-tab selection and Ctrl/Cmd+9 last-tab selection for crowded horizontal and vertical tab layouts.

### Changed

- Replace the redundant main-window title row with a native-controls overlay: horizontal tabs, the vertical navigation row, and Home now provide compact drag surfaces with theme-matched controls.
- Keep the vertical tab rail in its own left column while navigation and address controls use only the right content column.
- Publish the verified Windows portable checksum into the Scoop manifest after each release, then automatically dispatch full CI and the Windows install/reinstall smoke.

### Fixed

- Match native tab-menu directions to the selected layout: vertical rails now say “Move Tab Up,” “Move Tab Down,” and “Close Tabs Below” instead of describing horizontal movement.
- Keep “Close Other Tabs,” “Close Tabs to the Right,” and “Close Duplicate Tabs” inside the selected tab’s workspace so cleanup cannot remove unrelated workspace tabs.
- Show authoritative success or failure feedback after a human PDF export, including write errors that occur after Page Tools closes.
- Keep every tab, address input, toolbar action, and menu control explicitly non-draggable, preserve bare-Alt access to the native application menu, and reserve left- or right-side window-control safe areas at narrow widths and scaled displays.
- Keep the selected crowded tab fully reachable when the window or title-bar safe area changes, including compact horizontal layouts.
- Keep MCP user-attention requests active when an agent shows or focuses Hronaut, clearing them only after real human input.
- Keep Site Storage controls locked while a write, delete, or clear is pending so rapid actions cannot overlap, show stale entries, or discard a newer edit draft.
- Reset both Memory Saver preferences in one persisted transaction so a write failure cannot leave only half of the defaults applied.
- Reset MCP authentication and its listener port as one main-process transaction so a busy default port cannot leave authentication disabled on the previous listener.

## [1.6.1] - 2026-08-26

### Added

### Changed

- Move browser navigation, address, find, zoom, and bookmark controls out of `App.vue` into a focused component.
- Move website interaction-lock, split-view, capture, picker, and page-tools controls out of `App.vue` into a focused component.
- Move docked-panel resize presentation and input events out of `App.vue` into a focused accessible component.

### Fixed

- Retry transient renderer service startup failures without requiring an application restart, while keeping retries bounded and reporting recovery.
- Apply rapid repeated mute and interaction-lock toggles in order against the latest browser state instead of losing the second user action to a stale renderer snapshot.
- Prevent an element picker from starting while a viewport or full-page screenshot is still capturing and writing to the clipboard.
- Keep the latest Settings change authoritative when concurrent responses settle in request order, including full Appearance resets and language snapshots.
- Keep the latest successful browser action authoritative when concurrent responses settle in request order, preventing rapid tab selections from reverting while retaining a successful fallback if a newer action fails.

## [1.6.0] - 2026-08-26

### Added

- Add Midnight and Sepia everyday themes plus Matrix, Machine, and Galactic cinematic themes, with matching previews, native control color schemes, address suggestions, localization, and reduced-motion-safe effects.

### Changed

- Split the renderer's global stylesheet into ordered token, base, shell, tool, collection, dialog, settings, and docking modules, and colocate toast presentation with its component.
- Move detached-panel query parsing, labels, and window-title presentation out of `App.vue` into a focused controller.

### Fixed

## [1.5.3] - 2026-08-26

### Added

- Add a zero-cost Windows Scoop package smoke test that builds the portable app locally, verifies its shortcut and loopback MCP runtime, preserves external AppData across uninstall/reinstall, and avoids consuming public release-download counts.

### Changed

- Move Help and support shell orchestration out of `App.vue` into a focused controller.
- Verify after every published release that `hronaut.dev` resolves the new version and every platform download.
- Move detached-panel refresh dispatch out of `App.vue` into a focused, exhaustively tested controller.
- Reset all Appearance preferences in one authoritative transaction and prevent conflicting settings edits while a reset is pending.
- Move Settings reset routing and Appearance defaults out of `App.vue` into a focused controller.
- Move Privacy Settings open, refresh, and search-reset lifecycle ownership out of `App.vue` into its focused shell controller.
- Move update-notification visibility and auto-dismiss timing out of `App.vue` into a focused lifecycle controller.
- Move locale-aware shell formatting out of `App.vue` into a focused reactive composable.
- Use 100% as the default interface scale for fresh profiles and Appearance resets while preserving an existing explicit scale choice.

### Fixed

- Report a failed native GitHub Repository menu action in the shell instead of only logging it.
- Report failed Help and support link navigation instead of silently closing the dialog.
- Keep committed language changes authoritative when the follow-up Home refresh fails.
- Keep committed MCP authentication changes authoritative when the follow-up Home refresh fails.
- Make tab mute and close actions keyboard-operable from the focused tab and remove invalid nested button semantics.
- Keep completed workspace storage transfers authoritative when the follow-up workspace refresh fails, and block duplicate transfers until that refresh settles.
- Keep a tab context update from canceling a newer detached-panel request, and suppress refresh failures from panels that have already been superseded.
- Reset the interface language to the system default with the rest of the Appearance preferences.
- Keep completed browsing-data clears authoritative when the follow-up website inventory refresh fails, instead of presenting the destructive clear as failed.
- Reveal the selected tab after startup when its workspace had previously been collapsed, while preserving collapse state for unrelated workspaces.
- Give workspace tabs valid tab-list semantics, keep Settings landmarks valid, and raise light-theme secondary text contrast to WCAG AA across browser controls and Settings.
- Keep crowded-tab scroll buttons in reserved space instead of covering workspace names, tab titles, and the selected-tab marker.
- Open scheme-less localhost and IP loopback development addresses over HTTP instead of forcing them through HTTPS and producing a TLS failure.

## [1.5.2] - 2026-08-25

### Added

- Show OpenCode's `opencode mcp list` connection check directly beside its Hronaut Home setup.

### Changed

- Make the selected tab unmistakable with a persistent accent marker and stronger active surface, including the collapsed vertical rail.
- Move the complete tab and application-action chrome into the left rail when tabs are placed on the left, leaving only the navigation and address toolbar across the top.

### Fixed

- Open commercial-license pricing directly in the system browser and send license API requests to the canonical domain without a redirect that can rewrite POST requests.
- Remove vertical tab overflow controls once the remaining tabs fit the full rail again.
- Keep the selected tab immediately visible when switching a crowded tab strip from the top to the left rail.

## [1.5.1] - 2026-08-25

### Added

- Let an unpinned vertical tab rail collapse to favicon width and temporarily expand for pointer or keyboard interaction.

### Changed

- Move localized keyboard-shortcut presentation out of `App.vue` into the Help controller.

### Fixed

- Keep crowded vertical tabs clear of the fixed previous/next scroll controls.
- Preserve every rapid next/previous-tab shortcut by queueing relative selections against the latest active tab.
- Wait for Electron to finish opening Developer Tools before allowing debugger-backed browser actions to continue.

## [1.5.0] - 2026-08-25

### Added

- Add a persisted top/left tab position setting with a scrollable vertical rail for crowded sessions.
- Add a workspace context action that sleeps only eligible background tabs while preserving active, pinned, busy, and unsaved-form tabs.

### Changed

- Move browser tab mutation and action-specific error policy out of `App.vue` into a focused controller.
- Move Console and Network panel shell orchestration out of `App.vue` into a focused controller.

### Fixed

- Keep a partially visible active tab in view when earlier crowded-strip items expand, while still respecting deliberate scrolling away from it.
- Prevented rapid detached Page Tools switches from refreshing a panel that was already superseded before rendering.
- Keep the active tab visible when earlier pinned tabs or workspace labels expand in a crowded strip, without overriding deliberate tab-strip scrolling.
- Cancel a queued Network refresh when the panel is closed again before it finishes opening.

## [1.4.5] - 2026-08-25

### Changed

- Move global shell keyboard, modal priority, and Escape-surface routing out of `App.vue` into a focused controller.
- Move saved-password fill and account-picker orchestration out of `App.vue` into a focused controller.

### Fixed

- Keep command palettes, dialogs, and tool panels open when Escape belongs to an active IME composition.
- Cancel a pending credential fill when the user changes tabs or its page navigates or reloads, including same-origin pages, instead of filling a stale background document.
- Keep IME candidate navigation and confirmation inside address, command, tab-search, and credential inputs instead of moving, running, filling, or closing shell results.

## [1.4.4] - 2026-08-25

### Changed

- Split active-tab context transitions and detached-panel refresh coordination out of `App.vue` into focused controllers.
- Move shell overlay exclusivity, relayout, and native address-overlay coordination out of `App.vue` into a focused controller.

### Fixed

- Close crowded tabs with the familiar middle-click gesture without activating the page or bypassing the global interaction lock.
- Reset docked diagnostic panels when the current page reloads at the same URL so stale Network and Console evidence is not left visible.
- Keep an active tab visible when its workspace changes, and recompute crowded-tab overflow after tabs move into collapsed workspaces.
- Keep the active tab visible when a crowded tab strip becomes narrower after a window or toolbar resize.
- Close every competing docked tool panel when Site Controls, Site Storage, Bookmarks, or another shell overlay opens.
- Ignore stale detached-panel refresh failures after a newer tab context or window teardown.

## [1.4.3] - 2026-08-25

### Added

- Add workspace-aware Left/Right/Home/End keyboard navigation across visible tabs, with manual Enter/Space activation so browsing tab labels does not wake or switch pages.

### Changed

- Split address-focus and new-tab shell orchestration out of `App.vue` into focused navigation controllers.
- Split Site Storage shell orchestration out of `App.vue` into a focused controller.

### Fixed

- Prevent delayed shortcut or workspace tab creation from stealing address focus after a newer tab selection.
- Reject cross-workspace tab drag targets before showing a drop indicator or attempting an invalid reorder.
- Suppress obsolete Site Storage refresh failures after the panel closes or resets for a newer tab.

## [1.4.2] - 2026-08-25

### Fixed

- Keep crowded tab strips navigable with visible overflow controls, horizontal mouse-wheel scrolling, and automatic active-tab reveal.

## [1.4.1] - 2026-08-25

### Fixed

- Make `browser_press` dispatch modifier combinations and printable characters correctly instead of sending chord text as an invalid literal key.

## [1.4.0] - 2026-08-24

### Added

- Let `browser_wait` accept up to 20 candidate texts and resolve with the first visible match for workflows with multiple possible outcomes.
- Let `browser_click` dispatch Chromium's native double-click sequence for controls that require two clicks or a `dblclick` event.

### Changed

- Split Find-in-page shell orchestration out of `App.vue` into a focused controller.
- Split Tab Search shell orchestration out of `App.vue` into a focused controller.
- Split Zoom shell orchestration out of `App.vue` into a focused controller.

### Fixed

- Close the Split View menu and other competing surfaces when Find-in-page opens instead of stacking controls over the page.
- Close the Split View menu and other competing surfaces when Tab Search opens instead of stacking side panels over the page.
- Close the Split View menu and other competing surfaces when Zoom opens instead of stacking controls over the page.
- Fail `textGone` waits when the renderer cannot verify page text before the deadline instead of reporting unobserved absence as success.
- Reject `browser_click` prompt text unless the same call explicitly accepts the prompt, preventing an accidental blocking native dialog.

## [1.3.0] - 2026-08-24

### Added

- Add `textGone` to `browser_wait` for bounded waits until rendered page text disappears.

### Changed

- Split shared transient-panel closing policy out of `App.vue` into a focused controller.
- Split Split View menu shell orchestration out of `App.vue` into a focused controller.

### Fixed

- Close Find-in-page immediately when Page Tools or another transient panel opens, while completing browser-side Find cleanup in the background.
- Close Find-in-page when the Split View menu opens instead of stacking both controls over the page.

## [1.2.2] - 2026-08-24

### Changed

- Split Privacy Settings shell orchestration out of `App.vue` into a focused controller.
- Start Home, address-focus, and Zoom actions before awaiting Find-in-page cleanup through a shared transition controller.
- Retain the first failed Playwright Electron trace in CI without enabling retries, extract diagnostics from the disposable Docker container, and upload them for seven days.

### Fixed

- Open Privacy Settings immediately while Find-in-page cleanup finishes, and keep a newer close, section change, or Privacy request authoritative over delayed cleanup results.
- Prevent delayed Find-in-page cleanup from opening Home after a newer tab selection.

## [1.2.1] - 2026-08-24

### Added

- Add verified OpenCode MCP setup to Hronaut Home, the README, and the public setup guide, including global/project paths and connection diagnostics.

### Changed

- Split browser-collection panel orchestration out of `App.vue` into a focused controller.
- Split Site Controls shell orchestration out of `App.vue` into a focused controller.

### Fixed

- Keep the newest Downloads, Bookmarks, and History request authoritative, and prevent a late Downloads refresh from reopening or displacing a newer panel choice.
- Prevent a delayed Find-in-page cleanup from opening Site Controls underneath a newer Settings surface.
- Generate authenticated OpenCode headers with its token-file substitution instead of asking people to paste the owner token into JSON.
- Show the Hronaut “H” mark on Home instead of the stale pre-rename “B”.
- Document the canonical Cloudflare Pages storefront repository instead of a nonexistent GitHub Pages workflow in the desktop repository.

## [1.2.0] - 2026-08-24

### Added

- Add `browser_generate_locator`, which turns a snapshot ref or CSS selector into a unique Playwright locator while excluding form values and page source.
- Cover semantic, test-ID, CSS-fallback, escaping, and privacy edge cases with unit and real-Electron Docker regression tests.

### Changed

- Split command-palette shell orchestration and exhaustive command dispatch out of `App.vue` into a focused controller.
- Update the Home and public website catalog to advertise all 65 MCP tools and the locator-generation workflow.

## [1.1.1] - 2026-08-24

### Fixed

- Open **Buy commercial license** in the operating system's default browser instead of creating a Hronaut tab.

## [1.1.0] - 2026-08-24

### Added

- Add `browser_find`, a bounded literal search over Hronaut's sanitized semantic page snapshot that returns compact matching snippets and refs.
- Cover extracted browser-shell components, compact snapshot search, release workflow contracts, and the new MCP capability with unit and real-Electron regression tests.

### Changed

- Split the address and site-controls row, recoverable page-problem bar, and detached-panel empty state out of the renderer root component.
- Require lint, unit tests, production builds, dependency audits, and the Docker Electron suite before release package builds can start.

### Fixed

- Keep the Home dashboard and public website MCP tool counts derived from or tested against the live server catalog.
- Preserve source offsets for case-insensitive snapshot matches whose Unicode case folding changes string length.

## [1.0.0] - 2026-08-24

### Added

- Launch Hronaut 1.0.0: a visible, persistent local browser and QA workspace controlled through MCP.
- Publish Hronaut under the PolyForm Noncommercial License 1.0.0 with a separate paid commercial subscription license.

### Changed

- Establish the Hronaut release, update, package, executable, URL-scheme, profile, and environment-variable identities.
- Move the canonical source and release feed to `github.com/hronaut/hronaut`.
