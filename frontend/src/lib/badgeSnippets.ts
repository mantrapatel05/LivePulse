export function buildSnippets(publicId: string, apiUrl: string, dashboardUrl: string) {
  const img = `${apiUrl}/badge/${publicId}.svg`;
  const link = `${dashboardUrl}/?ref=badge&p=${publicId}`;
  return {
    html: `<a href="${link}"><img src="${img}" alt="LivePulse badge" height="30"></a>`,
    markdown: `[![LivePulse](${img})](${link})`,
    react: `<a href="${link}"><img src="${img}" alt="LivePulse badge" height={30} /></a>`,
  };
}
