export type DocumentChunk = {
  id: string;
  title: string;
  original: string;
  english: string;
  hindi: string;
  risk: 'Low' | 'Medium' | 'High' | 'Critical' | 'Warning';
  category?: string;
  mitigation?: string;
};

export type DocumentRecord = {
  id: string;
  name: string;
  pages: number;
  uploadedAt: string;
  riskScore: number;
  chunks: DocumentChunk[];
  status?: "processing" | "completed" | "failed";
};

export const documentLibrary: DocumentRecord[] = [
  {
    id: 'doc-saas-msa',
    name: 'saas-master-agreement.pdf',
    pages: 11,
    uploadedAt: 'Today',
    riskScore: 24,
    chunks: [
      {
        id: 'service-credit',
        title: 'Service Credit Terms',
        original:
          'Service credits are the sole and exclusive remedy for downtime and are capped at ten percent of the monthly subscription fee.',
        english:
          'If the service is down, your only remedy is a limited credit, not a refund or damages.',
        hindi:
          'यदि सेवा बंद रहती है तो आपका उपाय सीमित सेवा-क्रेडिट है, पूर्ण रिफंड या हर्जाना नहीं।',
        risk: 'Critical'
      },
      {
        id: 'renewal-window',
        title: 'Renewal Window',
        original:
          'The agreement auto-renews for 12 months unless written cancellation is received at least 45 days before the current term ends.',
        english:
          'The contract renews automatically unless you cancel early enough before the deadline.',
        hindi:
          'यदि समय पर रद्द नहीं किया गया तो अनुबंध स्वतः अगले कार्यकाल के लिए नवीनीकृत हो जाएगा।',
        risk: 'Warning'
      },
      {
        id: 'data-processing',
        title: 'Data Processing',
        original:
          'The processor may use subprocessors listed in Appendix B and will notify the customer before material changes.',
        english:
          'Your data can be handled by approved subprocessors, with notice before major updates.',
        hindi:
          'स्वीकृत उप-प्रोसेसर आपके डेटा को संभाल सकते हैं, और बड़े बदलाव से पहले सूचना दी जाएगी।',
        risk: 'Low'
      }
    ]
  }
];

export const quickQuestions = [
  'What remedies do I have for downtime?',
  'When does this contract auto-renew?',
  'Can subprocessors access customer data?'
];
