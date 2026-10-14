/**
 * ImageSlider - a dependency-free, infinitely looping image slider.
 *
 * Usage:
 *   const slider = new ImageSlider('#slider', { duration: 600 });
 *
 * The container's <img> children become the slides. The class builds the
 * viewport, sliding track, arrow buttons and indicator dots around them.
 *
 * Looping technique: a clone of the last slide is placed before the first
 * slide and a clone of the first slide after the last. Sliding onto a clone
 * is animated normally, then (after the transition ends) the track is moved
 * to the matching real slide with transitions disabled. The jump is
 * invisible, so the motion always continues in the direction of travel.
 */
class ImageSlider {
  static defaults = { duration: 600, autoplay: false, interval: 5000, swipe: true };

  constructor(target, options = {}) {
    this.root = typeof target === 'string' ? document.querySelector(target) : target;
    if (!this.root) throw new Error('ImageSlider: container not found');

    this.opts = { ...ImageSlider.defaults, ...options };
    this.slides = Array.from(this.root.querySelectorAll('img'));
    this.count = this.slides.length;
    if (this.count === 0) throw new Error('ImageSlider: no <img> slides found');

    this.position = 1;          // index in the track (1 = first real slide)
    this.isAnimating = false;   // lock while a transition is running
    this.timer = null;          // autoplay timer
    this.fallback = null;       // safety timeout for missed transitionend

    this.#build();
    this.#bind();
    this.#render(false);
    if (this.opts.autoplay) this.#startAutoplay();
  }

  /* ---------- Public API ---------- */
  get index() { return this.#toReal(this.position); }
  next() { this.#move(this.position + 1); }
  prev() { this.#move(this.position - 1); }
  goTo(i) { this.#move(((i % this.count) + this.count) % this.count + 1); }

  destroy() {
    clearTimeout(this.fallback);
    this.#stopAutoplay();
    this.root.replaceChildren(...this.slides);
    this.root.classList.remove('slider');
  }

  /* ---------- Construction ---------- */
  #build() {
    this.root.classList.add('slider');
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-roledescription', 'carousel');
    if (!this.root.hasAttribute('tabindex')) this.root.tabIndex = 0;

    this.viewport = el('div', 'slider__viewport');
    this.track = el('div', 'slider__track');

    const wrap = (img, clone = false) => {
      const slide = el('div', 'slider__slide');
      const node = clone ? img.cloneNode(true) : img;
      if (clone) { node.alt = ''; slide.setAttribute('aria-hidden', 'true'); }
      slide.append(node);
      return slide;
    };
    const first = this.slides[0], last = this.slides[this.count - 1];
    this.track.append(wrap(last, true), ...this.slides.map((s) => wrap(s)), wrap(first, true));
    this.viewport.append(this.track);

    this.prevBtn = el('button', 'slider__arrow slider__arrow--prev', '\u2039');
    this.nextBtn = el('button', 'slider__arrow slider__arrow--next', '\u203A');
    this.prevBtn.type = this.nextBtn.type = 'button';
    this.prevBtn.setAttribute('aria-label', 'Previous slide');
    this.nextBtn.setAttribute('aria-label', 'Next slide');

    this.dotsWrap = el('div', 'slider__dots');
    this.dots = this.slides.map((_, i) => {
      const dot = el('button', 'slider__dot');
      dot.type = 'button';
      dot.dataset.index = i;
      dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
      this.dotsWrap.append(dot);
      return dot;
    });

    this.root.replaceChildren(this.viewport, this.prevBtn, this.nextBtn, this.dotsWrap);
  }

  /* ---------- Events ---------- */
  #bind() {
    this.prevBtn.addEventListener('click', () => { this.prev(); this.#restartAutoplay(); });
    this.nextBtn.addEventListener('click', () => { this.next(); this.#restartAutoplay(); });

    // One delegated listener handles every dot.
    this.dotsWrap.addEventListener('click', (e) => {
      const dot = e.target.closest('.slider__dot');
      if (!dot) return;
      this.goTo(Number(dot.dataset.index));
      this.#restartAutoplay();
    });

    this.track.addEventListener('transitionend', (e) => {
      if (e.target === this.track && e.propertyName === 'transform') this.#settle();
    });

    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') this.next();
      else if (e.key === 'ArrowLeft') this.prev();
    });

    this.root.addEventListener('mouseenter', () => this.#stopAutoplay());
    this.root.addEventListener('mouseleave', () => this.opts.autoplay && this.#startAutoplay());

    if (this.opts.swipe) this.#bindSwipe();
  }

  #bindSwipe() {
    let startX = null;
    this.viewport.addEventListener('pointerdown', (e) => { startX = e.clientX; });
    this.viewport.addEventListener('pointerup', (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 40) (dx < 0 ? this.next() : this.prev());
    });
    this.viewport.addEventListener('pointercancel', () => { startX = null; });
  }

  /* ---------- Layout math & motion ---------- */
  #move(target) {
    if (this.isAnimating) return;
    if (target === this.position) return;
    this.isAnimating = true;
    this.position = target;
    this.#render(true);
    // Safety net in case transitionend never fires (e.g. hidden tab).
    clearTimeout(this.fallback);
    this.fallback = setTimeout(() => this.#settle(), this.opts.duration + 100);
  }

  // After a transition: if we landed on a clone, jump to its real twin.
  #settle() {
    clearTimeout(this.fallback);
    if (this.position === 0) this.position = this.count;
    else if (this.position === this.count + 1) this.position = 1;
    else { this.isAnimating = false; return; }
    this.#render(false);
    this.isAnimating = false;
  }

  #render(animate) {
    this.track.style.transition = animate
      ? `transform ${this.opts.duration}ms cubic-bezier(0.65, 0, 0.35, 1)`
      : 'none';
    // Each slide is 100% of the viewport, so the offset is simply -position * 100%.
    this.track.style.transform = `translateX(${-this.position * 100}%)`;
    if (!animate) void this.track.offsetWidth; // flush so the next transition starts cleanly

    const active = this.#toReal(this.position);
    this.dots.forEach((d, i) => {
      d.classList.toggle('is-active', i === active);
      d.setAttribute('aria-current', i === active ? 'true' : 'false');
    });
  }

  #toReal(pos) {
    if (pos === 0) return this.count - 1;
    if (pos === this.count + 1) return 0;
    return pos - 1;
  }

  /* ---------- Autoplay ---------- */
  #startAutoplay() { this.#stopAutoplay(); this.timer = setInterval(() => this.next(), this.opts.interval); }
  #stopAutoplay() { clearInterval(this.timer); this.timer = null; }
  #restartAutoplay() { if (this.opts.autoplay) this.#startAutoplay(); }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

if (typeof module !== 'undefined') module.exports = ImageSlider;
