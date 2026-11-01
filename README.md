# Remove Overlays and Filters

A Chrome extension that removes CSS blur from text, re-enables disabled scrolling, and removes any popup or element you click.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Reload any tabs that were already open.

Chrome warns that the extension can read and change data on all websites. It needs this so that elements you removed stay removed on your next visit. On page load, it only looks up the saved rules for the current site. Saved rules stay in your browser, and nothing is sent anywhere.

## Use

Click the extension's toolbar icon:

- **Remove blur** removes CSS blur from text on the current page.
- **Enable scrolling** removes CSS scroll locks from the current page.
- **Pick element to remove** starts the picker:
  - Hover over an element and click to remove it.
  - Press **↑** or **↓** to select the parent or child, which helps when a click lands inside a popup.
  - Keep clicking to remove more, such as a dialog and then its backdrop.
  - Press **Esc** to finish.

Blur and scroll fixes run only when you click them, and stay on until the page reloads. Removed elements are remembered per site and listed in the toolbar popup, where **×** brings one back.

## Limitations

- Scroll locks made with JavaScript, rather than CSS, aren't undone.
- Blurred images are left alone, and so is text in closed shadow roots.
- A saved rule can stop working, or hide the wrong element, if the site changes its markup. Use **×** to undo it.
- Saved elements can flash briefly while a page loads.

## Testing

Serve `test/test.html` over http, and add `?lock=overflow`, `?lock=fixed` or `?lock=wrapper` to choose a scroll lock.

Add `?popup=<kind>` to swap the default modal for a harder popup: `iframe`, `maxz`, `dialog`, `popover`, `htmlchild`, `openshadow` or `closedshadow`.
