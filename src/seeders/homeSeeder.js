import { Home } from "../models/Home.js";
import { LatestJob } from "../models/LatestJob.js";
import { Department } from "../models/Department.js";
export const seedHome = async () => {
  await Home.deleteMany();

  const latestJobs = await LatestJob.find({ type: "latest-jobs" })
    .sort({ publishedAt: -1 })
    .limit(6);
  const documents = await LatestJob.find({ type: "documents" })
    .sort({ publishedAt: -1 })
    .limit(6);
  const admitCards = await LatestJob.find({ type: "admit-cards" })
    .sort({ publishedAt: -1 })
    .limit(6);
  const results = await LatestJob.find({ type: "results" })
    .sort({ publishedAt: -1 })
    .limit(6);
  const admissions = await LatestJob.find({ type: "admissions" })
    .sort({ publishedAt: -1 })
    .limit(6);
  const answerKeys = await LatestJob.find({ type: "answer-keys" })
    .sort({ publishedAt: -1 })
    .limit(6);
  const departments = await Department.find().sort({ _id: -1 }).limit(12);
  await Home.create({
    what_is_rojgaar_suchna:
      "Rojgaar Suchna is your go-to portal for latest government job notifications, answer keys, admit cards, results and exam resources across India.",

    home_page_slider: [
      { title: "Rojgaar suchna", subtitle: "Your centralized platform for the latest government job notifications, results, admit cards, answer keys, and career updates — all in one place", image: "https://pub-09ddea2b87b6421a98cf13151ab300e3.r2.dev/sliders/slider-1.png", link: "#" },
      { title: "Stay Updated, Stay Ahead", subtitle: "Get fast and accurate updates from all government departments.Never miss a Sarkari job opportunity again", image: "https://pub-09ddea2b87b6421a98cf13151ab300e3.r2.dev/sliders/slider-2.png", link: "#" },
      { title: "One Portal. All Govt Jobs", subtitle: "Latest job alerts, syllabus, results, answer keys, admit cards everything you need, in one portal", image: "https://pub-09ddea2b87b6421a98cf13151ab300e3.r2.dev/sliders/slider-3.png", link: "#" }
    ],

    government_departments: departments.map(dep => ({
      refId: dep._id,
      refModel: "Department"
    })),
    sections: [
      {
        title: "Latest Jobs",
        jobs: latestJobs.map(job => ({
          refId: job._id,
          refModel: "LatestJob"
        }))
      },
      {
        title: "Documents",
        jobs: documents.map(doc => ({
          refId: doc._id,
          refModel: "LatestJob"
        }))
      },
      {
        title: "Admit Cards",
        jobs: admitCards.map(item => ({
          refId: item._id,
          refModel: "LatestJob"
        }))
      },
      {
        title: "Results",
        jobs: results.map(item => ({
          refId: item._id,
          refModel: "LatestJob"
        }))
      },
      {
        title: "Admissions",
        jobs: admissions.map(item => ({
          refId: item._id,
          refModel: "LatestJob"
        }))
      },
      {
        title: "Answer Keys",
        jobs: answerKeys.map(item => ({
          refId: item._id,
          refModel: "LatestJob"
        }))
      }
    ],

    faq: [
      {
        question: "What is Rojgaar Suchna?",
        answer: "A portal offering latest govt job notifications, exam resources and updates all in one place."
      }, {
        question: 'Is Rojgaar Suchna free to use?',
        answer: 'Yes, Rojgaar Suchna is completely free to use. We provide all job notifications, admit cards, results, and other information without any charges.'
      },
      {
        question: 'What kind of job updates do you post?',
        answer: 'We post updates about government job notifications, exam results, admit cards, answer keys, syllabi, career news, sarkari yojana, scholarships, and sarkari notices.'
      },
      {
        question: 'How often is the information updated?',
        answer: 'Our team updates the information daily to ensure you get the latest and most accurate job notifications and updates from various government departments.'
      },
      {
        question: 'Can I get notifications for new jobs?',
        answer: 'Yes, you can subscribe to our notifications to receive alerts about new job postings, exam dates, and other important updates directly.'
      },
      {
        question: 'How do I apply for a job listed on Rojgaar Suchna?',
        answer: 'Each job listing contains a direct link to the official application page. Simply click on the job post and follow the application instructions provided by the respective department.'
      },
      {
        question: 'Is Rojgaar Suchna affiliated with any government body?',
        answer: 'No, m Rojgaar Suchna is an independent platform. We aggregate and share information from various official government sources to help job seekers find opportunities easily.'
      }
    ],

    footer: {
      brand: "RS Rojgaar Suchna",

      useful_links: [
        { label: "About Us", link: "/about-us" },
        { label: "Contact Us", link: "/contact-us" },
        { label: "Privacy Policy", link: "/privacy-policy" },
        { label: "Terms of Service", link: "/terms-of-service" },
        { label: "Sitemap", link: "/sitemap" }
      ],

      popular_departments: departments.map(dep => ({
        refId: dep._id,
        refModel: "Department"
      })),

      contact: {
        email: "care.rojgaarsuchna@gmail.com",
        phone: "+919302905470",
        address: "123-A Job Street, Bhilai, Chhattisgarh, India"
      },

      social_links: [
        { label: 'YouTube', icon: '/yt.png', link: 'https://twitter.com/rojgaarsuchna' },
        { label: 'LinkedIn', icon: '/linkedin.png', link: 'https://linkedin.com/company/rojgaarsuchna', },
        { label: 'Twitter', icon: '/x.png', link: 'https://twitter.com/rojgaarsuchna', },
        { label: 'Facebook', icon: '/fb.png', link: 'https://facebook.com/rojgaarsuchna' },
        { label: 'Instagram', icon: '/instagram.png', link: 'https://instagram.com/rojgaarsuchna', },
      ]
    }
  });

  console.log("Home data seeded with realistic entries");
};
