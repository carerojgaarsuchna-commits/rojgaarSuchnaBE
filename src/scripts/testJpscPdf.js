import { discoverPdf } from "../services/pipeline/pdfDiscovery.service.js";

const html = `
  <html>
    <body>
      <table>
        <tr>
          <td>
            <a href="/data/Press_Release_03_24_dated_10_08_2026.pdf">
              Press release regarding Recruitment of Forest Range Officer and Assistant Conservator of Forest (Advt.No.-04/2024 and 03/2024) Dtd.10-08-2026
            </a>
          </td>
        </tr>
        <tr>
          <td>
            <a href="/data/Press_Release_old.pdf">
              Old Press Release 2023
            </a>
          </td>
        </tr>
      </table>
    </body>
  </html>
`;

const context = {
  matchedTitle:
    "Press release regarding Recruitment of Forest Range Officer and Assistant Conservator of Forest (Advt.No.-04/2024 and 03/2024) Dtd.10-08-2026",
  matchedHref: "/data/Press_Release_03_24_dated_10_08_2026.pdf",
  watchUrl: "https://jpsc.gov.in/",
  diffAdded:
    "Press release regarding Recruitment of Forest Range Officer and Assistant Conservator of Forest (Advt.No.-04/2024 and 03/2024) Dtd.10-08-2026",
};

discoverPdf(html, context).then((result) => {
  console.log("\n=== JPSC PDF DISCOVERY TEST RESULT ===");
  console.log("Decision:", result.decision);
  console.log("PDF URL: ", result.pdfUrl);
  console.log("Score:   ", result.score);
  console.log("\nTop Candidates:", result.candidates);
});
