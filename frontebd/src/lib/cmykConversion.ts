export async function convertPdfToCmykAndDownload(rgbPdfBlob: Blob, fileName: string = 'tickets-cmyk.pdf') {
  const formData = new FormData();
  formData.append('file', rgbPdfBlob, 'tickets-rgb.pdf');

  const response = await fetch('http://localhost:4000/api/convert-to-cmyk', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('CMYK conversion failed');
  }

  const cmykBlob = await response.blob();
  const url = URL.createObjectURL(cmykBlob);

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}
