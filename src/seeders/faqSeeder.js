import { Faq } from "../models/Faq.js";

export const seedFaqs = async () => {
  await Faq.deleteMany();
  await Faq.insertMany([
    { 
      question: "What is Rojgaar Suchna?", 
      answer: "Rojgaar Suchna is an employment information platform that provides verified updates on government jobs, exams, results, and recruitment notifications across India." 
    },
    { 
      question: "Is Rojgaar Suchna free to use?", 
      answer: "Yes, our platform is completely free for all users. No subscription or payment is required to access job alerts and updates." 
    },
    { 
      question: "How frequently is the information updated?", 
      answer: "Our data is updated regularly to ensure users receive the latest job notifications, admit card releases, answer keys, and result announcements." 
    },
    { 
      question: "Can I apply for jobs directly through Rojgaar Suchna?", 
      answer: "We do not process job applications. Users are redirected to official recruitment websites to complete their applications." 
    },
    { 
      question: "Are the job notifications authentic?", 
      answer: "Yes, all updates are sourced from official government portals and verified before publishing on our website." 
    },
    { 
      question: "Do you provide exam results and answer keys?", 
      answer: "Yes, we provide timely updates on exam results, answer keys, cut-off marks, and other exam-related announcements." 
    },
    { 
      question: "Can I receive job alerts?", 
      answer: "Yes, users can subscribe to notifications or follow our social channels to receive instant job alerts." 
    },
    { 
      question: "Do you cover state government jobs?", 
      answer: "Absolutely. We cover both central and state government job notifications across all states and union territories." 
    },
    { 
      question: "Do you provide exam preparation material?", 
      answer: "We currently focus on job notifications and exam updates. Study material and preparation support may be introduced soon." 
    },
    { 
      question: "How can I contact support?", 
      answer: "You can reach us through our contact form or support email available on the website for queries or feedback." 
    }
  ]);

  console.log("FAQs seeded successfully!");
};
