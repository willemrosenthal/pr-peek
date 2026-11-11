// Clicks a link. True if pr-peek stopped the click. The test stops it after, since
// jsdom can't load other pages.
export function clickLink(href: string, target?: string, metaKey = false) {
  const link = document.createElement("a");
  link.href = href;
  if (target) link.target = target;
  document.body.append(link);
  let stopped = false;
  const after = (event: Event) => {
    stopped = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", after);
  link.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, metaKey }),
  );
  document.removeEventListener("click", after);
  link.remove();
  return stopped;
}
