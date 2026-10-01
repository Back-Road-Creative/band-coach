// Shared DOM helper: builds an element from a tag, attrs (text / on* / attributes) and child nodes.
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.keys(attrs || {}).forEach((k) => {
    if (k === 'text') node.textContent = attrs[k];
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), attrs[k]);
    else node.setAttribute(k, attrs[k]);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => c && node.appendChild(c));
  return node;
}
