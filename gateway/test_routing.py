import ipaddress
import json
import pathlib
import unittest
from gateway.routing import update_ru_routing as rules

class RoutingDataTests(unittest.TestCase):
    def setUp(self):
        self.policy=json.loads((pathlib.Path(__file__).parents[1]/'data/ru-direct.json').read_text())

    def test_domain_parser_preserves_exact_rules_and_rejects_broad_foreign_suffixes(self):
        policy=self.policy
        text='payload:\n'+'\n'.join(' - +.'+d for d in policy['domainSuffixes'])+'\n - cdn.example.net\n'
        suffixes,exact=rules.parse_domains(text)
        self.assertIn('ru',suffixes);self.assertIn('cdn.example.net',exact)
        with self.assertRaises(ValueError):rules.parse_domains(text+'\n - +.com\n')

    def test_ip_validation_rejects_full_internet_and_preserves_country_ranges(self):
        text='\n'.join(self.policy['ipv4Cidrs'])
        networks=rules.parse_networks(text,4)
        self.assertEqual(rules.intervals(networks),self.policy['ipv4Ranges'])
        with self.assertRaises(ValueError):rules.parse_networks(text+'\n0.0.0.0/0\n',4)

    def test_generated_amnezia_entries_have_native_import_fields(self):
        texts={'domains':'payload:\n'+'\n'.join(' - +.'+d for d in self.policy['domainSuffixes']),
            'ipv4':'\n'.join(self.policy['ipv4Cidrs']),'ipv6':'\n'.join(self.policy['ipv6Cidrs'])}
        policy,entries,_=rules.build(texts,False)
        self.assertGreater(len(entries),1000)
        for entry in entries:
            self.assertEqual(entry['hostname'],entry['ip'])
            self.assertEqual(entry['ips'],[entry['ip']])
            self.assertEqual(ipaddress.ip_network(entry['ip']).version,4)

if __name__=='__main__':unittest.main()
