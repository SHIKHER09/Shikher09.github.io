console.log("Portfolio script loaded");

// Theme management
let theme = localStorage.getItem("theme");

// Set default theme if none exists
if (theme == null) {
  setTheme("blue");
} else {
  setTheme(theme);
}

// Add event listeners to theme dots
let themeDots = document.getElementsByClassName("theme-dot");
for (var i = 0; i < themeDots.length; i++) {
  themeDots[i].addEventListener("click", function () {
    let mode = this.dataset.mode;
    console.log("Theme selected:", mode);
    setTheme(mode);
  });
}

// Set theme function
function setTheme(mode) {
  const themeStylesheet = document.getElementById("theme-style");
  
  if (mode == "blue") {
    themeStylesheet.href = "blue.css";
  } else if (mode == "green") {
    themeStylesheet.href = "green.css";
  } else if (mode == "purple") {
    themeStylesheet.href = "purple.css";
  }
  
  localStorage.setItem("theme", mode);
  console.log("Theme set to:", mode);
}

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const href = this.getAttribute('href');
    if (href !== '#' && href !== '') {
      e.preventDefault();
      const target = document.querySelector(href);
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    }
  });
});

// Timeline animation (if timeline elements exist)
if (typeof IntersectionObserver !== 'undefined') {
  const timelineItems = document.querySelectorAll('.ag-timeline_item');
  
  if (timelineItems.length > 0) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('js-ag-active');
        }
      });
    }, {
      threshold: 0.3
    });

    timelineItems.forEach(item => {
      observer.observe(item);
    });
  }
}

// Form validation
const contactForm = document.getElementById('contact-form');
if (contactForm) {
  contactForm.addEventListener('submit', function(e) {
    const name = this.querySelector('input[name="name"]').value.trim();
    const email = this.querySelector('input[name="email"]').value.trim();
    const message = this.querySelector('textarea[name="message"]').value.trim();
    
    if (!name || !email || !message) {
      e.preventDefault();
      alert('Please fill in all fields before submitting.');
      return false;
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      e.preventDefault();
      alert('Please enter a valid email address.');
      return false;
    }
  });
}
