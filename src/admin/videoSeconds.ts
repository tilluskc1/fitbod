/** (#360) The browser's reading of a video file's length, in seconds (NaN when it can't). */
export function videoSeconds(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => done(video.duration);
    video.onerror = () => done(Number.NaN);
    video.src = url;
  });
}

