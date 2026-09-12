const controller = new AbortController();
setTimeout(() => controller.abort(), 100);
fetch("https://httpbin.org/delay/2", { signal: controller.signal })
  .catch(e => console.log(e.name, e.message));
