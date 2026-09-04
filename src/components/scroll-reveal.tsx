"use client";

import { useEffect } from "react";

/**
 * 滚动显现编排：观察带 data-reveal 的元素，进入视口后加 .is-revealed。
 * 页面数据多为客户端异步渲染，因此用 MutationObserver 跟进新增节点，
 * 已显现元素不重复动画，reduced-motion 用户直接可见。
 */
export function ScrollReveal() {
  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reducedMotion) {
      document
        .querySelectorAll<HTMLElement>("[data-reveal]")
        .forEach((el) => el.classList.add("is-revealed"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );

    const observeAll = () => {
      document
        .querySelectorAll<HTMLElement>("[data-reveal]:not(.is-revealed)")
        .forEach((el) => observer.observe(el));
    };

    const mutation = new MutationObserver(observeAll);
    mutation.observe(document.body, { childList: true, subtree: true });
    observeAll();

    return () => {
      observer.disconnect();
      mutation.disconnect();
    };
  }, []);

  return null;
}
