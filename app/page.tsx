import Link from 'next/link';
import { ArrowRightLeft, Globe, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <div>
      <section className="bg-white px-4 pb-20 pt-16 sm:px-6">
        <div className="mx-auto max-w-7xl text-center">
          <h1 className="text-3xl font-bold tracking-tight text-jac-dark sm:text-4xl lg:text-5xl">
            Gestion intelligente de vos
            <br />
            <span className="text-jac-red">traductions techniques</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-jac-text-secondary">
            Propagez vos modifications ou traduisez vos documents en un clic
          </p>
        </div>
      </section>

      <section className="bg-jac-bg-alt px-4 py-16 sm:px-6">
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
          <Link href="/propagate" className="group">
            <div className="flex h-full flex-col rounded border border-border bg-white p-8 shadow-sm transition-shadow hover:shadow-md">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-lg bg-red-50">
                <ArrowRightLeft className="h-7 w-7 text-jac-red" />
              </div>
              <h2 className="text-xl font-bold text-jac-dark">
                Propager des modifications
              </h2>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-jac-text-secondary">
                Uploadez un document annoté par couleurs et propagez les
                changements dans toutes les langues
              </p>
              <Button className="mt-6 w-full">
                Commencer
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>
          </Link>

          <Link href="/translate" className="group">
            <div className="flex h-full flex-col rounded border border-border bg-white p-8 shadow-sm transition-shadow hover:shadow-md">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-lg bg-red-50">
                <Globe className="h-7 w-7 text-jac-red" />
              </div>
              <h2 className="text-xl font-bold text-jac-dark">
                Traduire un document
              </h2>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-jac-text-secondary">
                Uploadez un document et obtenez sa traduction complète dans la
                langue de votre choix
              </p>
              <Button className="mt-6 w-full">
                Commencer
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>
          </Link>
        </div>
      </section>
    </div>
  );
}
