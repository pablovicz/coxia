/** Conteúdo do site (fixo nesta versão; muda por commit). */

export const SITE = {
  name: 'Casa Kaju',
  url: 'https://casakaju.com',
  tagline: 'Onde a cena encontra sua melhor forma.',
  description:
    'Casa Kaju: design cênico (figurino, cenografia, iluminação, adereços e bonecos), aluguel de sala de ensaio, sala de reunião, ateliê e estúdio fotográfico, e cursos.',
  instagram: 'https://www.instagram.com/kaju.cena/',
  instagramHandle: '@kaju.cena',
  whatsapp: '5541999071145',
  whatsappLabel: '(41) 99907-1145',
  email: 'trupenaque@gmail.com',
  /** Área da equipe (Coxia). */
  team: 'https://coxia.casakaju.com',
} as const;

export type ServiceKey = 'costume' | 'set_design' | 'lighting' | 'props' | 'puppets' | 'space_rental' | 'course' | 'other';
export type SegmentKey = 'theater' | 'audiovisual' | 'large_event' | 'private_event' | 'other';

export const SEGMENTS: Array<{ key: SegmentKey; label: string }> = [
  { key: 'theater', label: 'Teatro' },
  { key: 'audiovisual', label: 'Audiovisual' },
  { key: 'large_event', label: 'Shows / eventos de grande porte' },
  { key: 'private_event', label: 'Evento particular' },
  { key: 'other', label: 'Outro' },
];

export const SERVICES: Array<{ key: ServiceKey; label: string }> = [
  { key: 'costume', label: 'Figurino' },
  { key: 'set_design', label: 'Cenografia' },
  { key: 'lighting', label: 'Iluminação' },
  { key: 'props', label: 'Adereços' },
  { key: 'puppets', label: 'Bonecos' },
  { key: 'space_rental', label: 'Aluguel de espaço' },
  { key: 'course', label: 'Cursos' },
  { key: 'other', label: 'Outro' },
];

/** Espaços e serviços da casa (os círculos do site atual). */
export const SPACES: Array<{ slug: string; image: string; alt: string; service: ServiceKey; interest: string }> = [
  { slug: 'sala-de-ensaio', image: '/img/servicos/sala-de-ensaio.webp', alt: 'Aluguel: sala de ensaio', service: 'space_rental', interest: 'Sala de ensaio' },
  { slug: 'sala-de-reuniao', image: '/img/servicos/sala-de-reuniao.webp', alt: 'Aluguel: sala de reunião', service: 'space_rental', interest: 'Sala de reunião' },
  { slug: 'atelie', image: '/img/servicos/atelie.webp', alt: 'Aluguel: ateliê', service: 'space_rental', interest: 'Ateliê' },
  { slug: 'estudio-fotografico', image: '/img/servicos/estudio-fotografico.webp', alt: 'Aluguel: estúdio fotográfico', service: 'space_rental', interest: 'Estúdio fotográfico' },
  { slug: 'casa-inteira', image: '/img/servicos/casa-inteira.webp', alt: 'Aluguel: casa inteira', service: 'space_rental', interest: 'Casa inteira' },
  { slug: 'cafe-coworking', image: '/img/servicos/cafe-coworking.webp', alt: 'Café e coworking', service: 'space_rental', interest: 'Café e coworking' },
  { slug: 'cursos', image: '/img/servicos/cursos.webp', alt: 'Cursos Kaju', service: 'course', interest: 'Cursos' },
];

export const COURSES: Array<{ title: string; when: string }> = [
  { title: 'Curso de Adereços Cênicos', when: 'Data e horário a definir' },
  { title: 'Curso de Cerâmica Criativa', when: 'Data e horário a definir' },
  { title: 'Curso de Upcycling', when: 'Data e horário a definir' },
  { title: 'Curso de Crochê', when: 'Data e horário a definir' },
  { title: 'Curso de Costura Iniciante', when: 'Data e horário a definir' },
];

/** Link para o formulário de orçamento já com o serviço (e o interesse) escolhidos. */
export const quoteHref = (service?: ServiceKey, interest?: string) => {
  const q = new URLSearchParams();
  if (service) q.set('servico', service);
  if (interest) q.set('interesse', interest);
  const s = q.toString();
  return `/orcamento${s ? `?${s}` : ''}`;
};
