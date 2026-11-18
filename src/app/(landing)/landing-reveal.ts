// Section reveals for the landing story. Kept in a tiny module so LandingRoot can
// stamp in-view sections without waiting for the meadow canvas chunk.
export function startSectionReveals(root: HTMLElement, still: boolean): () => void {
  const docs = root.querySelectorAll('.vl-doc, .vl-meadow');
  if (still || !('IntersectionObserver' in window)) {
    docs.forEach((d) => d.classList.add('is-in'));
    return () => {};
  }
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
  docs.forEach((d) => io.observe(d));
  return () => io.disconnect();
}
