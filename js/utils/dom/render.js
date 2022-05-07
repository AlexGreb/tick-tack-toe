// export const render = (element) => {
//   containerElement.innerHTML = ``;
//   containerElement.appendChild(element);
// };

export const render = (html, className) => {
    const wrapper = document.createElement(`div`);
    if(className){
        wrapper.classList.add(className);
    }
    wrapper.innerHTML = html.trim();
    return wrapper;
}