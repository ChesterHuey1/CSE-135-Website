// Highlight the active nav link based on scroll position
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-links a');

function updateActiveLink() {
  let current = '';
  sections.forEach((section) => {
    if (window.scrollY >= section.offsetTop - 80) {
      current = section.getAttribute('id');
    }
  });

  navLinks.forEach((link) => {
    link.style.color = '';
    if (link.getAttribute('href') === `#${current}`) {
      link.style.color = '#111827';
      link.style.fontWeight = '600';
    } else {
      link.style.fontWeight = '';
    }
  });
}

window.addEventListener('scroll', updateActiveLink);
updateActiveLink();