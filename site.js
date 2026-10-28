document.documentElement.classList.add("js");

const header = document.querySelector(".site-header");
const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#main-navigation");

const setMenuState = (open) => {
  menuButton.classList.toggle("active", open);
  navigation.classList.toggle("is-open", open);
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
};

menuButton.addEventListener("click", () => setMenuState(menuButton.getAttribute("aria-expanded") !== "true"));
navigation.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenuState(false)));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && navigation.classList.contains("is-open")) { setMenuState(false); menuButton.focus(); }
});
document.addEventListener("click", (event) => {
  if (navigation.classList.contains("is-open") && !header.contains(event.target)) setMenuState(false);
});
window.addEventListener("resize", () => { if (window.innerWidth > 1024) setMenuState(false); });

// Sombra no cabeçalho ao rolar
const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

// Animação de entrada dos elementos
const revealItems = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  revealItems.forEach((item) => {
    const siblings = [...item.parentElement.children].filter((child) => child.classList.contains("reveal"));
    item.style.transitionDelay = `${Math.min(siblings.indexOf(item), 5) * 80}ms`;
    revealObserver.observe(item);
  });
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

// Destaque do link ativo no menu
const navLinks = [...navigation.querySelectorAll('a[href^="#"]')];
const sections = navLinks.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
if ("IntersectionObserver" in window) {
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((link) => link.classList.toggle("is-active", link.getAttribute("href") === `#${entry.target.id}`));
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  sections.forEach((section) => sectionObserver.observe(section));
}

// Apenas uma pergunta aberta por vez no FAQ
const faqItems = document.querySelectorAll(".faq-list details");
faqItems.forEach((item) => item.addEventListener("toggle", () => {
  if (item.open) faqItems.forEach((other) => { if (other !== item) other.open = false; });
}));

const currentYear = document.querySelector("#current-year");
if (currentYear) currentYear.textContent = String(new Date().getFullYear());

